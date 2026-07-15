-- =========================================================
-- Migration 0008: Arena Ticket System
-- Arena tickets already in users column (from 0001_init.sql):
--   arena_tickets_remaining int not null default 3
--   arena_tickets_reset_at  timestamptz not null default now()
-- This migration adds RPC battle_arena() which handles:
--   1. Lazy-reset tickets if new day (UTC)
--   2. Validate ticket availability
--   3. Validate entity level >= 15 (minimum Bitty)
--   4. Save log to arena_battles
--   5. Add SIG based on result (hardcoded: win=50, lose=20)
--   6. Deduct ticket
-- All operations performed atomically in one function.
-- =========================================================

create or replace function battle_arena(
  p_user_id   uuid,
  p_monster_id uuid,
  -- Stat opponent generated in server (Next.js), sent here as snapshot
  -- Battle calculation also done in server, result sent here for storage
  p_result    text,          -- 'win' | 'lose' (divalidasi via CHECK di arena_battles)
  p_opponent_snapshot jsonb, -- stat AI opponent untuk log/replay
  p_battle_log        jsonb  -- turn-by-turn log
)
returns jsonb                -- return { sig_reward, tickets_remaining }
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
  -- 1. Fetch user state with FOR UPDATE to prevent race condition
  --    if two battle requests arrive almost simultaneously (double-tap, etc).
  select arena_tickets_remaining, arena_tickets_reset_at
  into v_tickets, v_reset_at
  from users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User not found.';
  end if;

  -- 2. Lazy reset: if UTC date differs from reset_at, reset tickets to 3
  if date(v_reset_at at time zone 'UTC') < current_date then
    v_tickets := 3;
    update users
    set arena_tickets_remaining = 3,
        arena_tickets_reset_at  = now()
    where id = p_user_id;
  end if;

  -- 3. Validate ticket availability
  if v_tickets <= 0 then
    raise exception 'Arena tickets exhausted for today. Return tomorrow for 3 new tickets.';
  end if;

  -- 4. Validate minimum entity level 15 (Bitty+)
  select level into v_monster_level
  from monsters
  where id = p_monster_id and owner_id = p_user_id;

  if not found then
    raise exception 'Entity not found or not owned by summoner.';
  end if;

  if v_monster_level < 15 then
    raise exception 'Entity must be at least Level 15 (Bitty) to enter Arena.';
  end if;

  -- 5. Validate result value
  if p_result not in ('win', 'lose') then
    raise exception 'Invalid battle result.';
  end if;

  -- 6. Hardcode reward (cannot be manipulated externally)
  v_sig_reward := case p_result
    when 'win'  then 50
    when 'lose' then 20
    else 0
  end;

  -- 7. Insert battle log
  insert into arena_battles (owner_id, monster_id, opponent_snapshot, result, sig_reward, battle_log)
  values (p_user_id, p_monster_id, p_opponent_snapshot, p_result, v_sig_reward, p_battle_log)
  returning id into v_battle_id;

  -- 8. Deduct ticket and add SIG atomically
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

-- ── Permission: Restrict EXECUTE ke service_role saja ──────────────────────────
-- Postgres secara default grant EXECUTE ke PUBLIC untuk setiap fungsi baru.
-- Kita cabut dan hanya izinkan service_role (dipakai oleh Next.js server-side)
-- sehingga anon key dari browser tidak bisa memanggil fungsi ini langsung.
revoke execute on function battle_arena(uuid, uuid, text, jsonb, jsonb) from public;
grant  execute on function battle_arena(uuid, uuid, text, jsonb, jsonb) to service_role;
