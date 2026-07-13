-- =========================================================
-- Migration 0006: daily_quests_and_limited_tasks
-- Jalankan di Supabase SQL Editor atau via: supabase db push
-- =========================================================

-- 1. Tambah kolom fed_count ke daily_quests (jika belum ada)
alter table daily_quests add column if not exists fed_count int not null default 0;

-- 2. Buat tabel limited_tasks untuk one-time tasks
create table if not exists limited_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  task_type text not null, -- 'follow', 'like', 'retweet'
  claimed_at timestamptz not null default now(),
  unique (user_id, task_type)
);

-- Aktifkan RLS untuk limited_tasks
alter table limited_tasks enable row level security;

-- 3. Helper function untuk atomic tap increment
create or replace function increment_daily_tap(p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  insert into daily_quests (owner_id, quest_date, tap_count)
  values (p_user_id, current_date, 1)
  on conflict (owner_id, quest_date)
  do update set tap_count = daily_quests.tap_count + 1;
end;
$$;

-- 4. Re-create feed_monster RPC untuk menyertakan auto-increment fed_count
create or replace function feed_monster(
  p_monster_id   uuid,
  p_owner_id     uuid,
  p_food_key     text,
  p_satiety_cost int,
  p_stat_column  text,
  p_stat_value   numeric
)
returns void
language plpgsql
security definer
as $$
declare
  v_inv_qty int;
  v_satiety int;
  v_bonus_col text;
  v_sql text;
begin
  -- 1. Cek ketersediaan makanan di inventory
  select quantity into v_inv_qty
  from inventory
  where owner_id = p_owner_id and food_key = p_food_key;

  if v_inv_qty is null or v_inv_qty < 1 then
    raise exception 'Food tidak tersedia, beli dulu di shop';
  end if;

  -- 2. Cek status satiety monster
  select satiety into v_satiety
  from monsters
  where id = p_monster_id;

  if v_satiety is null then
    raise exception 'Monster tidak ditemukan';
  end if;

  if v_satiety < p_satiety_cost then
    raise exception 'Monster butuh istirahat, satiety belum cukup, tunggu regenerasi';
  end if;

  -- 3. Kurangi makanan di inventory (hapus jika sisa 0)
  update inventory
  set quantity = quantity - 1
  where owner_id = p_owner_id and food_key = p_food_key;

  delete from inventory
  where owner_id = p_owner_id and food_key = p_food_key and quantity <= 0;

  -- 4. Kurangi satiety monster dan reset timer regenerasi satiety
  update monsters
  set
    satiety = satiety - p_satiety_cost,
    satiety_last_regen_at = now()
  where id = p_monster_id;

  -- 5. Tambahkan bonus status secara permanen di monster_food_bonus
  -- Validasi nama kolom untuk mencegah SQL injection
  if p_stat_column not in ('hp', 'atk', 'def', 'spd', 'crit', 'dodge') then
    raise exception 'Kolom status tidak valid: %', p_stat_column;
  end if;

  v_bonus_col := p_stat_column || '_bonus';
  v_sql := format(
    'update monster_food_bonus set %I = %I + $1, updated_at = now() where monster_id = $2',
    v_bonus_col, v_bonus_col
  );

  execute v_sql using p_stat_value, p_monster_id;

  -- 6. Update daily_quests fed_count secara atomic (upsert)
  insert into daily_quests (owner_id, quest_date, fed_count)
  values (p_owner_id, current_date, 1)
  on conflict (owner_id, quest_date)
  do update set fed_count = daily_quests.fed_count + 1;
end;
$$;

-- 5. RPC function untuk claim daily quest reward secara atomic
create or replace function claim_daily_quest(
  p_user_id uuid,
  p_quest_type text, -- 'login', 'tap', 'feed'
  p_reward_sig bigint
)
returns void
language plpgsql
security definer
as $$
declare
  v_quest_date date := current_date;
  v_claimed boolean;
  v_progress int;
begin
  -- 1. Ambil status klaim dan progress saat ini
  if p_quest_type = 'login' then
    select login_claimed into v_claimed
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
    v_progress := 1; -- Login selalu dianggap 1 jika baris terbuat
  elsif p_quest_type = 'tap' then
    select tap_claimed, tap_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'feed' then
    select feed_claimed, fed_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
  else
    raise exception 'Tipe quest tidak valid: %', p_quest_type;
  end if;

  -- 2. Validasi
  if v_claimed is null then
    raise exception 'Quest harian belum terinisialisasi untuk hari ini.';
  end if;

  if v_claimed = true then
    raise exception 'Quest ini sudah diklaim hari ini.';
  end if;

  -- Cek kecukupan target progress (login: 1, tap: 100, feed: 1)
  if p_quest_type = 'login' and v_progress < 1 then
    raise exception 'Quest login belum selesai.';
  elsif p_quest_type = 'tap' and v_progress < 100 then
    raise exception 'Quest tap belum selesai (butuh 100 tap, progres saat ini: %).', v_progress;
  elsif p_quest_type = 'feed' and v_progress < 1 then
    raise exception 'Quest feed belum selesai.';
  end if;

  -- 3. Update status claimed
  if p_quest_type = 'login' then
    update daily_quests set login_claimed = true where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'tap' then
    update daily_quests set tap_claimed = true where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'feed' then
    update daily_quests set feed_claimed = true where owner_id = p_user_id and quest_date = v_quest_date;
  end if;

  -- 4. Tambah SIG balance user
  update users
  set sig_balance = sig_balance + p_reward_sig
  where id = p_user_id;
end;
$$;

-- 6. RPC function untuk claim limited task reward secara atomic
create or replace function claim_limited_task(
  p_user_id uuid,
  p_task_type text, -- 'follow', 'like', 'retweet'
  p_reward_sig bigint
)
returns void
language plpgsql
security definer
as $$
begin
  -- 1. Insert ke limited_tasks. Otomatis gagal jika sudah ada (unique constraint)
  insert into limited_tasks (user_id, task_type)
  values (p_user_id, p_task_type);

  -- 2. Tambah SIG balance user
  update users
  set sig_balance = sig_balance + p_reward_sig
  where id = p_user_id;
exception
  when unique_violation then
    raise exception 'Task "%" sudah diklaim sebelumnya.', p_task_type;
end;
$$;
