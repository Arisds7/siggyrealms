-- =========================================================
-- Reset Database Script - Hapus semua tabel dan fungsi
-- Jalankan ini di Supabase SQL Editor sebelum migration files
-- =========================================================

-- Drop functions (harus di-drop dulu karena mungkin ada dependencies)
-- Drop semua signature function yang mungkin ada
DROP FUNCTION IF EXISTS regen_all_monster_attributes(int, numeric, int, int, numeric, int) CASCADE;
DROP FUNCTION IF EXISTS regen_all_monster_energy(int, numeric, int) CASCADE;
DROP FUNCTION IF EXISTS evolve_monster(uuid, uuid, text, text, bigint, bigint, numeric) CASCADE;
DROP FUNCTION IF EXISTS evolve_monster(uuid, uuid, text, bigint, bigint, numeric) CASCADE;
DROP FUNCTION IF EXISTS feed_monster(uuid, uuid, text, int, text, numeric) CASCADE;
DROP FUNCTION IF EXISTS claim_daily_quest(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS claim_daily_quest(uuid, text, bigint) CASCADE;
DROP FUNCTION IF EXISTS claim_limited_task(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS claim_limited_task(uuid, text, bigint) CASCADE;
DROP FUNCTION IF EXISTS battle_arena(uuid, uuid, text, jsonb, jsonb) CASCADE;
DROP FUNCTION IF EXISTS increment_daily_tap(uuid, int) CASCADE;
DROP FUNCTION IF EXISTS increment_daily_tap(uuid) CASCADE;
DROP FUNCTION IF EXISTS buy_item(uuid, text, int) CASCADE;

-- Drop tables dalam urutan yang benar (child tables dulu)
DROP TABLE IF EXISTS arena_battles CASCADE;
DROP TABLE IF EXISTS limited_tasks CASCADE;
DROP TABLE IF EXISTS daily_quests CASCADE;
DROP TABLE IF EXISTS inventory CASCADE;
DROP TABLE IF EXISTS monster_food_bonus CASCADE;
DROP TABLE IF EXISTS monster_stats CASCADE;
DROP TABLE IF EXISTS monsters CASCADE;
DROP TABLE IF EXISTS foods CASCADE;
DROP TABLE IF EXISTS species CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop tipe enum jika ada
DROP TYPE IF EXISTS evolution_stage_enum CASCADE;
