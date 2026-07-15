-- =========================================================
-- Restore Backup Monsters
-- Script untuk restore 2 monster dari backup ke database
-- =========================================================

-- ─── 1. Insert Users ──────────────────────────────────────────────────────────────
-- User 1: Owner of Cindrel (Token ID 1)
INSERT INTO users (id, wallet_address, twitter_handle, sig_balance, arena_tickets_remaining, arena_tickets_reset_at)
VALUES (
  '427ecbf3-0e6b-4624-b826-4ceb6bc5939f',
  '0x52De50454D1864960e88B849f6ef7f5a75d30a4A',
  'user1_placeholder', -- Ganti dengan twitter handle asli
  0, -- Default SIG balance
  3, -- Default arena tickets
  now()
) ON CONFLICT (wallet_address) DO NOTHING;

-- User 2: Owner of Mossel (Token ID 2)
INSERT INTO users (id, wallet_address, twitter_handle, sig_balance, arena_tickets_remaining, arena_tickets_reset_at)
VALUES (
  '7b20bf0f-4118-400c-a193-fd2fa1e8dfcd',
  '0x071D526C718fc28775Dd701769A6268d526FC7fA',
  'user2_placeholder', -- Ganti dengan twitter handle asli
  0, -- Default SIG balance
  3, -- Default arena tickets
  now()
) ON CONFLICT (wallet_address) DO NOTHING;

-- ─── 2. Insert Monsters ────────────────────────────────────────────────────────────
-- Monster 1: Cindrel (Level 23)
INSERT INTO monsters (
  id, owner_id, species_key, nickname, token_id, mint_tx_hash,
  level, exp, evolution_stage, personality_trait,
  energy, energy_last_regen_at, satiety, satiety_last_regen_at, created_at
)
VALUES (
  'c6c24675-961e-4440-869a-f1d5ad9c0eb4',
  '427ecbf3-0e6b-4624-b826-4ceb6bc5939f',
  'cindrel',
  NULL,
  1,
  '0xab8f5224c01db0334a61e64e9ef0e90e82b8450b307f90abfaae33c70842694f',
  23,
  2210,
  'initiate',
  NULL,
  79,
  '2026-07-04 17:55:08.488891+00',
  100,
  '2026-07-04 17:55:08.488891+00',
  '2026-07-04 17:55:08.488891+00'
) ON CONFLICT (id) DO NOTHING;

-- Monster 2: Mossel (Level 1)
INSERT INTO monsters (
  id, owner_id, species_key, nickname, token_id, mint_tx_hash,
  level, exp, evolution_stage, personality_trait,
  energy, energy_last_regen_at, satiety, satiety_last_regen_at, created_at
)
VALUES (
  'ba22acdf-a752-4bf7-a395-fa71b49ab1ce',
  '7b20bf0f-4118-400c-a193-fd2fa1e8dfcd',
  'mossel',
  NULL,
  2,
  '0xa3924af401b128c7f0fcb5d2806919b32fc8b2712250db67627e0df7c0a6b458',
  1,
  0,
  'initiate',
  NULL,
  300,
  '2026-07-04 17:44:11.747598+00',
  100,
  '2026-07-04 17:44:11.747598+00',
  '2026-07-04 17:44:11.747598+00'
) ON CONFLICT (id) DO NOTHING;

-- ─── 3. Insert Monster Stats (Base Stats from species) ────────────────────────────────
-- Cindrel Base Stats: hp=120, atk=28, def=14, spd=16, crit=5, dodge=5
INSERT INTO monster_stats (monster_id, hp, atk, def, spd, crit, dodge, updated_at)
VALUES (
  'c6c24675-961e-4440-869a-f1d5ad9c0eb4',
  120, 28, 14, 16, 5.00, 5.00, now()
) ON CONFLICT (monster_id) DO NOTHING;

-- Mossel Base Stats: hp=140, atk=22, def=18, spd=12, crit=5, dodge=5
INSERT INTO monster_stats (monster_id, hp, atk, def, spd, crit, dodge, updated_at)
VALUES (
  'ba22acdf-a752-4bf7-a395-fa71b49ab1ce',
  140, 22, 18, 12, 5.00, 5.00, now()
) ON CONFLICT (monster_id) DO NOTHING;

-- ─── 4. Insert Monster Food Bonus (Default 0) ─────────────────────────────────────────
INSERT INTO monster_food_bonus (monster_id, hp_bonus, atk_bonus, def_bonus, spd_bonus, crit_bonus, dodge_bonus, updated_at)
VALUES (
  'c6c24675-961e-4440-869a-f1d5ad9c0eb4',
  0, 0, 0, 0, 0.00, 0.00, now()
) ON CONFLICT (monster_id) DO NOTHING;

INSERT INTO monster_food_bonus (monster_id, hp_bonus, atk_bonus, def_bonus, spd_bonus, crit_bonus, dodge_bonus, updated_at)
VALUES (
  'ba22acdf-a752-4bf7-a395-fa71b49ab1ce',
  0, 0, 0, 0, 0.00, 0.00, now()
) ON CONFLICT (monster_id) DO NOTHING;

-- ─── 5. Initialize Daily Quests for Today ────────────────────────────────────────────
INSERT INTO daily_quests (owner_id, quest_date, login_claimed, tap_count, tap_claimed, fed_count, feed_claimed)
VALUES (
  '427ecbf3-0e6b-4624-b826-4ceb6bc5939f',
  current_date,
  false, 0, false, 0, false
) ON CONFLICT (owner_id, quest_date) DO NOTHING;

INSERT INTO daily_quests (owner_id, quest_date, login_claimed, tap_count, tap_claimed, fed_count, feed_claimed)
VALUES (
  '7b20bf0f-4118-400c-a193-fd2fa1e8dfcd',
  current_date,
  false, 0, false, 0, false
) ON CONFLICT (owner_id, quest_date) DO NOTHING;
