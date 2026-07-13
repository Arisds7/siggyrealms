-- =========================================================
-- Migration 0007: fix_reward_hardcode
-- Jalankan di Supabase SQL Editor atau via: supabase db push
-- =========================================================

-- 1. Hapus fungsi lama terlebih dahulu untuk menghindari overload signature di Postgres
drop function if exists claim_daily_quest(uuid, text, bigint);
drop function if exists claim_limited_task(uuid, text, bigint);

-- 2. Re-create claim_daily_quest tanpa parameter reward_sig (hardcoded di DB)
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
  -- Tentukan jumlah reward SIG harian berdasarkan jenis quest
  v_reward_sig := case p_quest_type
    when 'login' then 50
    when 'tap' then 100
    when 'feed' then 50
    else null
  end;

  if v_reward_sig is null then
    raise exception 'Tipe quest tidak valid: %', p_quest_type;
  end if;

  -- 1. Ambil status klaim dan progress saat ini
  if p_quest_type = 'login' then
    select login_claimed into v_claimed
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
    v_progress := 1; -- Login selalu dianggap 1 jika baris harian terinisialisasi
  elsif p_quest_type = 'tap' then
    select tap_claimed, tap_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
  elsif p_quest_type = 'feed' then
    select feed_claimed, fed_count into v_claimed, v_progress
    from daily_quests
    where owner_id = p_user_id and quest_date = v_quest_date;
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
  set sig_balance = sig_balance + v_reward_sig
  where id = p_user_id;
end;
$$;

-- 3. Re-create claim_limited_task tanpa parameter reward_sig (hardcoded di DB)
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
  -- Tentukan jumlah reward SIG limited/one-time berdasarkan jenis task
  v_reward_sig := case p_task_type
    when 'follow' then 1000
    when 'like' then 1000
    when 'retweet' then 1000
    else null
  end;

  if v_reward_sig is null then
    raise exception 'Tipe task tidak valid: %', p_task_type;
  end if;

  -- 1. Insert ke limited_tasks. Otomatis gagal jika sudah ada (unique constraint)
  insert into limited_tasks (user_id, task_type)
  values (p_user_id, p_task_type);

  -- 2. Tambah SIG balance user
  update users
  set sig_balance = sig_balance + v_reward_sig
  where id = p_user_id;
exception
  when unique_violation then
    raise exception 'Task "%" sudah diklaim sebelumnya.', p_task_type;
end;
$$;
