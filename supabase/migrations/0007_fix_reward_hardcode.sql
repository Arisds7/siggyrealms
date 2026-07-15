-- =========================================================
-- Migration 0007: fix_reward_hardcode
-- Run in Supabase SQL Editor or via: supabase db push
-- =========================================================

-- 1. Drop old functions first to avoid Postgres overload signature
drop function if exists claim_daily_quest(uuid, text, bigint);
drop function if exists claim_limited_task(uuid, text, bigint);

-- 2. Re-create claim_daily_quest without reward_sig parameter (hardcoded in DB)
create or replace function claim_daily_quest(
  p_user_id uuid,
  p_quest_type text -- 'login', 'tap', 'feed'
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
  -- Determine daily quest SIG reward amount based on quest type
  v_reward_sig := case p_quest_type
    when 'login' then 50
    when 'tap' then 100
    when 'feed' then 50
    else null
  end;

  if v_reward_sig is null then
    raise exception 'Invalid quest type: %', p_quest_type;
  end if;

  -- 1. Fetch current claim status and progress
  if p_quest_type = 'login' then
    select login_claimed into v_claimed
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
    v_progress := 1; -- Login always considered 1 if daily row initialized
  elsif p_quest_type = 'tap' then
    select tap_claimed, tap_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'feed' then
    select feed_claimed, fed_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
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
  set sig_balance = sig_balance + v_reward_sig
  where id = p_user_id;
end;
$$;

-- 3. Re-create claim_limited_task without reward_sig parameter (hardcoded in DB)
create or replace function claim_limited_task(
  p_user_id uuid,
  p_task_type text -- 'follow', 'like', 'retweet'
)
returns void
language plpgsql
security definer
as $$
declare
  v_reward_sig bigint;
begin
  -- Determine limited/one-time task SIG reward amount based on task type
  v_reward_sig := case p_task_type
    when 'follow' then 1000
    when 'like' then 1000
    when 'retweet' then 1000
    else null
  end;

  if v_reward_sig is null then
    raise exception 'Invalid task type: %', p_task_type;
  end if;

  -- 1. Insert into limited_tasks. Automatically fails if already exists (unique constraint)
  insert into limited_tasks (user_id, task_type)
  values (p_user_id, p_task_type);

  -- 2. Add SIG to summoner balance
  update users
  set sig_balance = sig_balance + v_reward_sig
  where id = p_user_id;
exception
  when unique_violation then
    raise exception 'Task "%" has already been claimed before.', p_task_type;
end;
$$;
