-- =========================================================
-- Migration 0009: Revoke RPC public access
-- Jalankan di Supabase SQL Editor atau via: supabase db push
-- =========================================================

-- 1. Cabut hak akses eksekusi dari PUBLIC, anon, dan authenticated untuk semua RPC sensitif
-- 2. Berikan hak akses eksekusi hanya ke service_role (digunakan backend Next.js)

-- evolve_monster
revoke execute on function evolve_monster(uuid, uuid, text, bigint, bigint, numeric) from public, anon, authenticated;
grant execute on function evolve_monster(uuid, uuid, text, bigint, bigint, numeric) to service_role;

-- feed_monster
revoke execute on function feed_monster(uuid, uuid, text, int, text, numeric) from public, anon, authenticated;
grant execute on function feed_monster(uuid, uuid, text, int, text, numeric) to service_role;

-- claim_daily_quest
revoke execute on function claim_daily_quest(uuid, text) from public, anon, authenticated;
grant execute on function claim_daily_quest(uuid, text) to service_role;

-- claim_limited_task
revoke execute on function claim_limited_task(uuid, text) from public, anon, authenticated;
grant execute on function claim_limited_task(uuid, text) to service_role;

-- regen_all_monster_attributes
revoke execute on function regen_all_monster_attributes(int, numeric, int, int, numeric, int) from public, anon, authenticated;
grant execute on function regen_all_monster_attributes(int, numeric, int, int, numeric, int) to service_role;

-- increment_daily_tap
revoke execute on function increment_daily_tap(uuid) from public, anon, authenticated;
grant execute on function increment_daily_tap(uuid) to service_role;
