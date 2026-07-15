-- =========================================================
-- Migration: Energy Regeneration RPC Function
-- Run in Supabase SQL Editor or via: supabase db push
-- =========================================================

-- This function is called by endpoint /api/cron/energy-regen
-- every 5 minutes via GitHub Actions.
--
-- Logic:
--   1. Calculate how many "ticks" (interval p_interval_minutes) have
--      elapsed since energy_last_regen_at.
--   2. Add (ticks * p_regen_per_tick) energy, capped at p_max_energy.
--   3. Advance energy_last_regen_at by (ticks * interval), not
--      set to NOW() — so remaining minutes not yet 1 full tick
--      are not lost and counted in the next cycle.
--   4. Only update entities with energy < p_max_energy AND
--      elapsed at least 1 tick (efficiency: skip entities that don't
--      need update at all).
--   5. Return number of rows updated (for logging in API route).

create or replace function regen_all_monster_energy(
  p_max_energy       int     default 300,
  p_interval_minutes numeric default 3,
  p_regen_per_tick   int     default 1
)
returns int
language plpgsql
security definer   -- executed with function owner privileges, bypass RLS
as $$
declare
  v_updated int;
begin
  with monsters_to_update as (
    select
      id,
      energy,
      energy_last_regen_at,
      -- how many full ticks have elapsed
      floor(
        extract(epoch from (now() - energy_last_regen_at)) / 60.0
        / p_interval_minutes
      )::int as ticks_elapsed
    from monsters
    where
      energy < p_max_energy
      and floor(
            extract(epoch from (now() - energy_last_regen_at)) / 60.0
            / p_interval_minutes
          ) >= 1
  )
  update monsters m
  set
    energy = least(
      p_max_energy,
      m.energy + (u.ticks_elapsed * p_regen_per_tick)
    ),
    -- Advance timestamp by ticks processed,
    -- not set to now() — so remaining minutes are not lost.
    energy_last_regen_at = m.energy_last_regen_at
      + (u.ticks_elapsed * p_interval_minutes * interval '1 minute')
  from monsters_to_update u
  where m.id = u.id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;
