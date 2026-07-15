-- =========================================================
-- Migration 0005: regen_all_monster_attributes()
-- Run in Supabase SQL Editor or via: supabase db push
-- =========================================================

create or replace function regen_all_monster_attributes(
  p_max_energy       int     default 300,
  p_energy_interval  numeric default 3,
  p_energy_per_tick  int     default 1,
  p_max_satiety      int     default 100,
  p_satiety_interval numeric default 60,
  p_satiety_per_tick int     default 10
)
returns table(energy_updated int, satiety_updated int)
language plpgsql
security definer
as $$
declare
  v_energy_updated int := 0;
  v_satiety_updated int := 0;
begin
  -- 1. Update energy in bulk
  with energy_to_update as (
    select
      id,
      floor(
        extract(epoch from (now() - energy_last_regen_at)) / 60.0
        / p_energy_interval
      )::int as ticks_elapsed
    from monsters
    where
      energy < p_max_energy
      and floor(
            extract(epoch from (now() - energy_last_regen_at)) / 60.0
            / p_energy_interval
          ) >= 1
  )
  update monsters m
  set
    energy = least(
      p_max_energy,
      m.energy + (u.ticks_elapsed * p_energy_per_tick)
    ),
    energy_last_regen_at = m.energy_last_regen_at
      + (u.ticks_elapsed * p_energy_interval * interval '1 minute')
  from energy_to_update u
  where m.id = u.id;

  get diagnostics v_energy_updated = row_count;

  -- 2. Update satiety in bulk
  with satiety_to_update as (
    select
      id,
      floor(
        extract(epoch from (now() - satiety_last_regen_at)) / 60.0
        / p_satiety_interval
      )::int as ticks_elapsed
    from monsters
    where
      satiety < p_max_satiety
      and floor(
            extract(epoch from (now() - satiety_last_regen_at)) / 60.0
            / p_satiety_interval
          ) >= 1
  )
  update monsters m
  set
    satiety = least(
      p_max_satiety,
      m.satiety + (u.ticks_elapsed * p_satiety_per_tick)
    ),
    satiety_last_regen_at = m.satiety_last_regen_at
      + (u.ticks_elapsed * p_satiety_interval * interval '1 minute')
  from satiety_to_update u
  where m.id = u.id;

  get diagnostics v_satiety_updated = row_count;

  return query select v_energy_updated, v_satiety_updated;
end;
$$;
