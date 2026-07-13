-- ---------------------------------------------------------
-- Update increment_daily_tap helper function to support
-- incrementing by a customizable count (defaulting to 1).
-- This is backward-compatible and supports client-side tap batching.
-- ---------------------------------------------------------

create or replace function increment_daily_tap(p_user_id uuid, p_count int default 1)
returns void
language plpgsql
security definer
as $$
begin
  insert into daily_quests (owner_id, quest_date, tap_count)
  values (p_user_id, current_date, p_count)
  on conflict (owner_id, quest_date)
  do update set tap_count = daily_quests.tap_count + p_count;
end;
$$;

-- Explicitly grant execute permission to service_role (preserving Security Hardening from 0009)
revoke execute on function increment_daily_tap(uuid, int) from public, anon, authenticated;
grant execute on function increment_daily_tap(uuid, int) to service_role;
