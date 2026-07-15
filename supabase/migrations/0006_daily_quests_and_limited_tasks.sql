-- =========================================================
-- Migration 0006: daily_quests_and_limited_tasks
-- Run in Supabase SQL Editor or via: supabase db push
-- =========================================================

-- 1. Add fed_count column to daily_quests (if not exists)
alter table daily_quests add column if not exists fed_count int not null default 0;

-- 2. Create limited_tasks table for one-time quests
create table if not exists limited_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_type text not null, -- 'follow', 'like', 'retweet'
  claimed_at timestamptz not null default now(),
  unique (user_id, task_type)
);

-- Enable RLS for limited_tasks
alter table limited_tasks enable row level security;

-- 3. Helper function for atomic tap increment
create or replace function increment_daily_tap(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  insert into daily_quests (owner_id, quest_date, tap_count)
  values (p_user_id, current_date, 1)
  on conflict (owner_id, quest_date)
  do update set tap_count = daily_quests.tap_count + 1;
end;
$$;

-- 4. Re-create feed_monster RPC to include auto-increment fed_count
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
  -- 1. Check offering availability in Vault
  select quantity into v_inv_qty
  from inventory
  where owner_id = p_owner_id and food_key = p_food_key;

  if v_inv_qty is null or v_inv_qty < 1 then
    raise exception 'Offering not available in Vault. Visit the Bazaar first';
  end if;

  -- 2. Check entity satiety status
  select satiety into v_satiety
  from monsters
  where id = p_monster_id;

  if v_satiety is null then
    raise exception 'Entity not found';
  end if;

  if v_satiety < p_satiety_cost then
    raise exception 'Entity requires rest. Satiety insufficient. Await regeneration.';
  end if;

  -- 3. Decrement offering from Vault (remove if remainder is 0)
  update inventory
  set quantity = quantity - 1
  where owner_id = p_owner_id and food_key = p_food_key;

  delete from inventory
  where owner_id = p_owner_id and food_key = p_food_key and quantity <= 0;

  -- 4. Decrement entity satiety and reset satiety regeneration timer
  update monsters
  set
    satiety = satiety - p_satiety_cost,
    satiety_last_regen_at = now()
  where id = p_monster_id;

  -- 5. Apply permanent stat bonus via monster_food_bonus
  -- Validate column name to prevent SQL injection
  if p_stat_column not in ('hp', 'atk', 'def', 'spd', 'crit', 'dodge') then
    raise exception 'Invalid stat column: %', p_stat_column;
  end if;

  v_bonus_col := p_stat_column || '_bonus';
  v_sql := format(
    'update monster_food_bonus set %I = %I + $1, updated_at = now() where monster_id = $2',
    v_bonus_col, v_bonus_col
  );

  execute v_sql using p_stat_value, p_monster_id;

  -- 6. Update daily_quests fed_count atomically (upsert)
  insert into daily_quests (owner_id, quest_date, fed_count)
  values (p_owner_id, current_date, 1)
  on conflict (owner_id, quest_date)
  do update set fed_count = daily_quests.fed_count + 1;
end;
$$;

-- 5. RPC function for atomic daily quest reward claim
create or replace function claim_daily_quest(
  p_user_id uuid,
  p_quest_type text, -- 'login', 'tap', 'feed'
  p_reward_sig bigint
)
returns void
language plpgsql
security definer
as $$
declare
  v_quest_date date := current_date;
  v_claimed boolean;
  v_progress int;
begin
  -- 1. Fetch current claim status and progress
  if p_quest_type = 'login' then
    select login_claimed into v_claimed
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
    v_progress := 1; -- Login always considered 1 if row exists
  elsif p_quest_type = 'tap' then
    select tap_claimed, tap_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'feed' then
    select feed_claimed, fed_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
  else
    raise exception 'Invalid quest type: %', p_quest_type;
  end if;

  -- 2. Validate
  if v_claimed is null then
    raise exception 'Daily quest not initialized for today.';
  end if;

  if v_claimed = true then
    raise exception 'This quest has already been claimed today.';
  end if;

  -- Check target progress sufficiency (login: 1, tap: 100, feed: 1)
  if p_quest_type = 'login' and v_progress < 1 then
    raise exception 'Login quest not completed.';
  elsif p_quest_type = 'tap' and v_progress < 100 then
    raise exception 'Tap quest not completed (requires 100 taps, current progress: %).', v_progress;
  elsif p_quest_type = 'feed' and v_progress < 1 then
    raise exception 'Feed quest not completed.';
  end if;

  -- 3. Update claimed status
  if p_quest_type = 'login' then
    update daily_quests set login_claimed = true where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'tap' then
    update daily_quests set tap_claimed = true where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'feed' then
    update daily_quests set feed_claimed = true where owner_id = p_user_id and quest_date = v_quest_date;
  end if;

  -- 4. Add SIG to summoner balance
  update users
  set sig_balance = sig_balance + p_reward_sig
  where id = p_user_id;
end;
$$;

-- 6. RPC function for atomic limited task reward claim
create or replace function claim_limited_task(
  p_user_id uuid,
  p_task_type text, -- 'follow', 'like', 'retweet'
  p_reward_sig bigint
)
returns void
language plpgsql
security definer
as $$
begin
  -- 1. Insert into limited_tasks. Automatically fails if already exists (unique constraint)
  insert into limited_tasks (user_id, task_type)
  values (p_user_id, p_task_type);

  -- 2. Add SIG to summoner balance
  update users
  set sig_balance = sig_balance + p_reward_sig
  where id = p_user_id;
exception
  when unique_violation then
    raise exception 'Task "%" has already been claimed before.', p_task_type;
end;
$$;
