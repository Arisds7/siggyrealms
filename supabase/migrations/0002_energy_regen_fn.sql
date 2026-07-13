-- =========================================================
-- Migration: Energy Regeneration RPC Function
-- Jalankan di Supabase SQL Editor atau via: supabase db push
-- =========================================================

-- Fungsi ini dipanggil oleh endpoint /api/cron/energy-regen
-- setiap 5 menit via GitHub Actions.
--
-- Logika:
--   1. Hitung berapa banyak "tick" (interval p_interval_minutes) yang
--      sudah berlalu sejak energy_last_regen_at.
--   2. Tambahkan (ticks * p_regen_per_tick) energy, di-cap di p_max_energy.
--   3. Maju-kan energy_last_regen_at sebesar (ticks * interval), bukan
--      set ke NOW() — supaya sisa menit yang belum genap 1 tick tidak
--      hilang dan ikut terhitung di cycle berikutnya.
--   4. Hanya update monster yang energy-nya < p_max_energy DAN
--      sudah lewat minimal 1 tick (efisiensi: skip monster yang belum
--      perlu update sama sekali).
--   5. Return jumlah baris yang diupdate (untuk logging di API route).

create or replace function regen_all_monster_energy(
  p_max_energy       int     default 300,
  p_interval_minutes numeric default 3,
  p_regen_per_tick   int     default 1
)
returns int
language plpgsql
security definer   -- dijalankan dengan hak pemilik fungsi, bypass RLS
as $$
declare
  v_updated int;
begin
  with monsters_to_update as (
    select
      id,
      energy,
      energy_last_regen_at,
      -- berapa tick penuh yang sudah berlalu
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
    -- Maju-kan timestamp sebesar tick yang sudah diproses,
    -- bukan set ke now() — supaya sisa menit tidak hilang.
    energy_last_regen_at = m.energy_last_regen_at
      + (u.ticks_elapsed * p_interval_minutes * interval '1 minute')
  from monsters_to_update u
  where m.id = u.id;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;
