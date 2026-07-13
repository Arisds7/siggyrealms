-- =========================================================
-- Siggy Realms V1 — Initial Schema
-- Jalankan file ini di Supabase SQL Editor, atau via CLI:
--   supabase db push
-- =========================================================

-- ---------------------------------------------------------
-- 1. USERS
-- ---------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique not null,
  twitter_handle text not null,
  sig_balance bigint not null default 0,      -- saldo SIG coin
  arena_tickets_remaining int not null default 3,
  arena_tickets_reset_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2. SPECIES  (data referensi 5 monster, jarang berubah)
-- ---------------------------------------------------------
create table if not exists species (
  key text primary key,               -- 'cindrel', 'tidera', dst
  name text not null,
  element text not null check (element in ('fire', 'water', 'nature', 'lightning', 'dark')),
  role text not null,
  base_hp int not null,
  base_atk int not null,
  base_def int not null,
  base_spd int not null,
  base_crit numeric(5,2) not null,    -- persen, contoh 5.00
  base_dodge numeric(5,2) not null
);

insert into species (key, name, element, role, base_hp, base_atk, base_def, base_spd, base_crit, base_dodge)
values
  ('cindrel', 'Cindrel', 'fire', 'Fighter', 120, 28, 14, 16, 5, 5),
  ('tidera', 'Tidera', 'water', 'Tank', 180, 18, 25, 8, 3, 3),
  ('mossel', 'Mossel', 'nature', 'Balanced / Support', 140, 22, 18, 12, 5, 5),
  ('voltra', 'Voltra', 'lightning', 'Assassin', 95, 26, 10, 30, 8, 10),
  ('umbren', 'Umbren', 'dark', 'Burst Mage', 110, 32, 10, 18, 12, 6)
on conflict (key) do nothing;

-- ---------------------------------------------------------
-- 3. MONSTERS  (1 baris = 1 NFT/monster milik user)
-- ---------------------------------------------------------
create table if not exists monsters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  species_key text not null references species(key),
  nickname text,
  token_id bigint,                    -- id NFT onchain, diisi setelah tx mint confirmed
  mint_tx_hash text,
  level int not null default 1,
  exp int not null default 0,
  evolution_stage text not null default 'initiate'
    check (evolution_stage in ('initiate', 'ritty', 'bitty', 'ritualist', 'radiant_ritualist')),
  personality_trait text,             -- opsional, kalau dipakai lagi dari versi awal (brave/lazy/dst)
  energy int not null default 300,
  energy_last_regen_at timestamptz not null default now(),
  satiety int not null default 100,
  satiety_last_regen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_monsters_owner on monsters(owner_id);

-- ---------------------------------------------------------
-- 4. MONSTER_STATS  (stat kalkulasi terkini: base + evolusi, TANPA food bonus)
-- Dipisah dari monster_food_bonus supaya gampang re-kalkulasi ulang
-- kalau formula evolusi berubah, tanpa kehilangan food bonus yang sudah didapat.
-- ---------------------------------------------------------
create table if not exists monster_stats (
  monster_id uuid primary key references monsters(id) on delete cascade,
  hp int not null,
  atk int not null,
  def int not null,
  spd int not null,
  crit numeric(5,2) not null,
  dodge numeric(5,2) not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 5. MONSTER_FOOD_BONUS  (akumulasi bonus permanen dari makanan, terpisah dari base)
-- ---------------------------------------------------------
create table if not exists monster_food_bonus (
  monster_id uuid primary key references monsters(id) on delete cascade,
  hp_bonus int not null default 0,
  atk_bonus int not null default 0,
  def_bonus int not null default 0,
  spd_bonus int not null default 0,
  crit_bonus numeric(5,2) not null default 0,
  dodge_bonus numeric(5,2) not null default 0,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 6. FOODS  (data referensi, jarang berubah)
-- ---------------------------------------------------------
create table if not exists foods (
  key text primary key,               -- 'berry', 'meat', dst
  name text not null,
  effect_stat text not null,          -- 'hp' | 'atk' | 'def' | 'spd' | 'crit' | 'dodge'
  effect_value numeric(6,2) not null,
  price_sig int not null,
  satiety_cost int not null default 10
);

insert into foods (key, name, effect_stat, effect_value, price_sig, satiety_cost) values
  ('berry', 'Berry', 'hp', 5, 20, 10),
  ('meat', 'Meat', 'atk', 1, 25, 10),
  ('shell', 'Shell', 'def', 1, 25, 10),
  ('feather', 'Feather', 'spd', 1, 25, 10),
  ('crystal', 'Crystal', 'crit', 0.5, 40, 10),
  ('mist', 'Mist', 'dodge', 0.5, 40, 10)
on conflict (key) do nothing;

-- ---------------------------------------------------------
-- 7. INVENTORY  (food yang dibeli user tapi belum dipakai)
-- ---------------------------------------------------------
create table if not exists inventory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  food_key text not null references foods(key),
  quantity int not null default 0,
  unique (owner_id, food_key)
);

-- ---------------------------------------------------------
-- 8. DAILY_QUESTS  (progress quest harian per user, reset tiap hari)
-- ---------------------------------------------------------
create table if not exists daily_quests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  quest_date date not null default current_date,
  login_claimed boolean not null default false,
  tap_count int not null default 0,          -- progress menuju 100 tap
  tap_claimed boolean not null default false,
  feed_claimed boolean not null default false,
  unique (owner_id, quest_date)
);

-- ---------------------------------------------------------
-- 9. ARENA_BATTLES  (log tiap battle, buat riwayat & anti-cheat audit)
-- ---------------------------------------------------------
create table if not exists arena_battles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id) on delete cascade,
  monster_id uuid not null references monsters(id) on delete cascade,
  opponent_snapshot jsonb not null,   -- stat lawan AI saat battle terjadi (buat replay/log)
  result text not null check (result in ('win', 'lose')),
  sig_reward int not null,
  battle_log jsonb,                   -- detail turn-by-turn, opsional buat UI battle log
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Row Level Security (RLS) — WAJIB diaktifkan sebelum go-live
-- Untuk Week 1, minimal aktifkan dulu supaya user hanya bisa
-- baca/tulis data miliknya sendiri lewat client (anon key).
-- Service role key (dipakai di API route/cron) otomatis bypass RLS.
-- ---------------------------------------------------------
alter table users enable row level security;
alter table monsters enable row level security;
alter table monster_stats enable row level security;
alter table monster_food_bonus enable row level security;
alter table inventory enable row level security;
alter table daily_quests enable row level security;
alter table arena_battles enable row level security;

-- Catatan: policy detail (misal "user hanya bisa select row miliknya
-- berdasarkan wallet_address di JWT") baru bisa ditulis presisi setelah
-- skema auth wallet-based difinalkan di Week 1 — buat sekarang RLS
-- diaktifkan dulu tanpa policy supaya default DENY, aman by default.
