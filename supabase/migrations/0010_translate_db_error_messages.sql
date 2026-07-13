-- ==============================================================================
-- Migration 0010: translate_db_error_messages_and_lock_fixes
--
-- 1. Translates all database-level error messages to immersive English.
-- 2. Adds strict row locking (FOR UPDATE) to prevent race conditions on balance 
--    and progress updates.
-- 3. Fixes evolution stats multiplication by verifying current_stage matches.
-- 4. Creates an atomic buy_item RPC to handle shop purchases safely.
-- ==============================================================================

-- ─── 1. EVOLVE MONSTER RPC ────────────────────────────────────────────────────
-- Drop old signature first
drop function if exists evolve_monster(uuid, uuid, text, bigint, bigint, numeric);

create or replace function evolve_monster(
  p_monster_id      uuid,
  p_owner_id        uuid,
  p_current_stage   text,
  p_next_stage      text,
  p_cost_sig        bigint,
  p_reward_sig      bigint,
  p_stat_multiplier numeric
)
returns void
language plpgsql
security definer
as $$
declare
  v_sig_balance bigint;
  v_db_owner_id uuid;
  v_db_stage    text;
begin
  -- a. Lock user row to get latest sig_balance and prevent concurrent balance updates
  select sig_balance into v_sig_balance
  from users
  where id = p_owner_id
  for update;

  if not found then
    raise exception 'Summoner not found in the Codex: %', p_owner_id;
  end if;

  -- b. Lock monster row to prevent concurrent evolution updates
  select owner_id, evolution_stage into v_db_owner_id, v_db_stage
  from monsters
  where id = p_monster_id
  for update;

  if not found then
    raise exception 'Entity not found in the Codex: %', p_monster_id;
  end if;

  -- c. Verify ownership
  if v_db_owner_id <> p_owner_id then
    raise exception 'Entity does not belong to your Vault.';
  end if;

  -- d. Verify evolution stage hasn''t shifted (concurrency check)
  if v_db_stage <> p_current_stage then
    raise exception 'Entity evolution stage has shifted. Ritual aborted.';
  end if;

  -- e. Verify stage isn''t already the next stage
  if v_db_stage = p_next_stage then
    raise exception 'Entity has already ascended to this stage.';
  end if;

  -- f. Verify SIG balance
  if v_sig_balance < p_cost_sig then
    raise exception 'Insufficient SIG in your Vault to perform ascension.';
  end if;

  -- g. Deduct cost and add reward
  update users
  set sig_balance = sig_balance - p_cost_sig + p_reward_sig
  where id = p_owner_id;

  -- h. Scale base stats — food_bonus columns intentionally excluded
  update monster_stats
  set
    hp    = round(hp    * p_stat_multiplier),
    atk   = round(atk   * p_stat_multiplier),
    def   = round(def   * p_stat_multiplier),
    spd   = round(spd   * p_stat_multiplier),
    crit  = round(crit  * p_stat_multiplier, 2),
    dodge = round(dodge * p_stat_multiplier, 2),
    updated_at = now()
  where monster_id = p_monster_id;

  if not found then
    raise exception 'Entity stats not found in the Codex for: %', p_monster_id;
  end if;

  -- i. Update evolution stage on the monster row
  update monsters
  set evolution_stage = p_next_stage
  where id = p_monster_id;
end;
$$;

revoke execute on function evolve_monster(uuid, uuid, text, text, bigint, bigint, numeric) from public;
grant  execute on function evolve_monster(uuid, uuid, text, text, bigint, bigint, numeric) to service_role;


-- ─── 2. FEED MONSTER RPC ──────────────────────────────────────────────────────
create or replace function feed_monster(
  p_monster_id   uuid,
  p_owner_id     uuid,
  p_food_key     text,
  p_satiety_cost int,
  p_stat_column  text,
  p_stat_value   numeric
)
returns void
language plpgsql
security definer
as $$
declare
  v_inv_qty int;
  v_satiety int;
  v_bonus_col text;
  v_sql text;
begin
  -- 1. Check food availability in Vault
  select quantity into v_inv_qty
  from inventory
  where owner_id = p_owner_id and food_key = p_food_key;

  if v_inv_qty is null or v_inv_qty < 1 then
    raise exception 'This offering is not in your Vault. Acquire it from the Bazaar first.';
  end if;

  -- 2. Check entity satiety
  select satiety into v_satiety
  from monsters
  where id = p_monster_id;

  if v_satiety is null then
    raise exception 'Entity not found in the Codex.';
  end if;

  if v_satiety < p_satiety_cost then
    raise exception 'Your Siggy needs to rest — satiety is too low. Wait for recovery.';
  end if;

  -- 3. Decrement food from Vault (remove row if quantity reaches 0)
  update inventory
  set quantity = quantity - 1
  where owner_id = p_owner_id and food_key = p_food_key;

  delete from inventory
  where owner_id = p_owner_id and food_key = p_food_key and quantity <= 0;

  -- 4. Reduce satiety and reset the regeneration timer
  update monsters
  set
    satiety = satiety - p_satiety_cost,
    satiety_last_regen_at = now()
  where id = p_monster_id;

  -- 5. Apply permanent stat bonus via monster_food_bonus
  if p_stat_column not in ('hp', 'atk', 'def', 'spd', 'crit', 'dodge') then
    raise exception 'Invalid stat column: %', p_stat_column;
  end if;

  v_bonus_col := p_stat_column || '_bonus';
  v_sql := format(
    'update monster_food_bonus set %I = %I + $1, updated_at = now() where monster_id = $2',
    v_bonus_col, v_bonus_col
  );

  execute v_sql using p_stat_value, p_monster_id;

  -- 6. Update daily quest fed_count atomically (upsert)
  insert into daily_quests (owner_id, quest_date, fed_count)
  values (p_owner_id, current_date, 1)
  on conflict (owner_id, quest_date)
  do update set fed_count = daily_quests.fed_count + 1;
end;
$$;


-- ─── 3. BATTLE ARENA RPC ──────────────────────────────────────────────────────
create or replace function battle_arena(
  p_user_id   uuid,
  p_monster_id uuid,
  p_result    text,
  p_opponent_snapshot jsonb,
  p_battle_log        jsonb
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_tickets        int;
  v_reset_at       timestamptz;
  v_monster_level  int;
  v_sig_reward     bigint;
  v_new_tickets    int;
  v_battle_id      uuid;
begin
  -- 1. Lock user row to prevent race conditions (double-battle tap, etc.)
  select arena_tickets_remaining, arena_tickets_reset_at
  into v_tickets, v_reset_at
  from users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Summoner not found in the Codex.';
  end if;

  -- 2. Lock check and JIT reset
  if date(v_reset_at at time zone 'UTC') < current_date then
    v_tickets := 3;
    update users
    set arena_tickets_remaining = 3,
        arena_tickets_reset_at  = now()
    where id = p_user_id;
  end if;

  -- 3. Validate ticket availability
  if v_tickets <= 0 then
    raise exception 'Your Battle Tickets are exhausted. Return at UTC midnight for 3 new Tickets.';
  end if;

  -- 4. Validate entity minimum level (Bitty — Level 15+)
  select level into v_monster_level
  from monsters
  where id = p_monster_id and owner_id = p_user_id;

  if not found then
    raise exception 'Entity not found or does not belong to your Vault.';
  end if;

  if v_monster_level < 15 then
    raise exception 'Your Siggy must reach Level 15 (Bitty) before entering the Arena.';
  end if;

  -- 5. Validate result value
  if p_result not in ('win', 'lose') then
    raise exception 'Invalid battle result.';
  end if;

  -- 6. Hard-coded SIG rewards (cannot be manipulated externally)
  v_sig_reward := case p_result
    when 'win'  then 50
    when 'lose' then 20
    else 0
  end;

  -- 7. Insert battle log
  insert into arena_battles (owner_id, monster_id, opponent_snapshot, result, sig_reward, battle_log)
  values (p_user_id, p_monster_id, p_opponent_snapshot, p_result, v_sig_reward, p_battle_log)
  returning id into v_battle_id;

  -- 8. Deduct ticket and award SIG atomically
  v_new_tickets := v_tickets - 1;
  update users
  set sig_balance             = sig_balance + v_sig_reward,
      arena_tickets_remaining = v_new_tickets
  where id = p_user_id;

  return jsonb_build_object(
    'battle_id',         v_battle_id,
    'sig_reward',        v_sig_reward,
    'tickets_remaining', v_new_tickets,
    'result',            p_result
  );
end;
$$;

revoke execute on function battle_arena(uuid, uuid, text, jsonb, jsonb) from public;
grant  execute on function battle_arena(uuid, uuid, text, jsonb, jsonb) to service_role;


-- ─── 4. CLAIM DAILY QUEST RPC ─────────────────────────────────────────────────
create or replace function claim_daily_quest(
  p_user_id uuid,
  p_quest_type text
)
returns void
language plpgsql
security definer
as $$
declare
  v_quest_date date := current_date;
  v_claimed boolean;
  v_progress int;
  v_reward_sig bigint;
begin
  -- Tentukan jumlah reward SIG harian berdasarkan jenis quest
  v_reward_sig := case p_quest_type
    when 'login' then 50
    when 'tap' then 100
    when 'feed' then 50
    else null
  end;

  if v_reward_sig is null then
    raise exception 'Invalid quest type: %', p_quest_type;
  end if;

  -- 1. Lock user row to prevent concurrent balance updates
  perform 1 from users where id = p_user_id for update;

  -- 2. Lock progress row and fetch claimed status (atomic check)
  if p_quest_type = 'login' then
    select login_claimed into v_claimed
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date
    for update;
    v_progress := 1;
  elsif p_quest_type = 'tap' then
    select tap_claimed, tap_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date
    for update;
  elsif p_quest_type = 'feed' then
    select feed_claimed, fed_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date
    for update;
  end if;

  -- 3. Verification
  if v_claimed is null then
    raise exception 'Daily quests not initialized for today.';
  end if;

  if v_claimed = true then
    raise exception 'This quest reward has already been claimed today.';
  end if;

  -- Verify target progress
  if p_quest_type = 'login' and v_progress < 1 then
    raise exception 'Login quest not completed.';
  elsif p_quest_type = 'tap' and v_progress < 100 then
    raise exception 'Tap quest not completed (needs 100 taps, current: %).', v_progress;
  elsif p_quest_type = 'feed' and v_progress < 1 then
    raise exception 'Feed quest not completed.';
  end if;

  -- 4. Update claimed status
  if p_quest_type = 'login' then
    update daily_quests set login_claimed = true where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'tap' then
    update daily_quests set tap_claimed = true where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'feed' then
    update daily_quests set feed_claimed = true where owner_id = p_user_id and quest_date = v_quest_date;
  end if;

  -- 5. Add SIG reward
  update users
  set sig_balance = sig_balance + v_reward_sig
  where id = p_user_id;
end;
$$;

revoke execute on function claim_daily_quest(uuid, text) from public;
grant  execute on function claim_daily_quest(uuid, text) to service_role;


-- ─── 5. ATOMIC BUY ITEM RPC ───────────────────────────────────────────────────
create or replace function buy_item(
  p_user_id   uuid,
  p_food_key  text,
  p_quantity  int
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_sig_balance  bigint;
  v_price_sig    int;
  v_food_name    text;
  v_total_cost   bigint;
  v_new_quantity int;
begin
  -- 1. Lock user row to prevent race conditions on balance deduction
  select sig_balance into v_sig_balance
  from users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'Summoner not found in the Codex.';
  end if;

  -- 2. Fetch food pricing
  select price_sig, name into v_price_sig, v_food_name
  from foods
  where key = p_food_key;

  if not found then
    raise exception 'Item not found in the Realm.';
  end if;

  -- 3. Verify balance
  v_total_cost := v_price_sig * p_quantity;
  if v_sig_balance < v_total_cost then
    raise exception 'Insufficient SIG balance. Needed: %, you have: %.', v_total_cost, v_sig_balance;
  end if;

  -- 4. Deduct SIG balance
  update users
  set sig_balance = sig_balance - v_total_cost
  where id = p_user_id;

  -- 5. Upsert inventory atomically
  insert into inventory (owner_id, food_key, quantity)
  values (p_user_id, p_food_key, p_quantity)
  on conflict (owner_id, food_key)
  do update set quantity = inventory.quantity + p_quantity
  returning quantity into v_new_quantity;

  return jsonb_build_object(
    'success',      true,
    'food_name',    v_food_name,
    'new_balance',  v_sig_balance - v_total_cost,
    'new_quantity', v_new_quantity
  );
end;
$$;

revoke execute on function buy_item(uuid, text, int) from public;
grant  execute on function buy_item(uuid, text, int) to service_role;
