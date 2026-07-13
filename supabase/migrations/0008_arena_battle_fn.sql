-- =========================================================
-- Migration 0008: Arena Ticket System
-- Arena tickets sudah di-kolom users (dari 0001_init.sql):
--   arena_tickets_remaining int not null default 3
--   arena_tickets_reset_at  timestamptz not null default now()
-- Migration ini menambahkan RPC battle_arena() yang menangani:
--   1. Lazy-reset tiket jika sudah hari baru (UTC)
--   2. Validasi tiket tersedia
--   3. Validasi monster level >= 15 (minimal Bitty)
--   4. Simpan log ke arena_battles
--   5. Tambah SIG sesuai hasil (hardcoded: win=50, lose=20)
--   6. Kurangi tiket
-- Semua operasi dilakukan atomik dalam satu function.
-- =========================================================

create or replace function battle_arena(
  p_user_id   uuid,
  p_monster_id uuid,
  -- Stat opponent di-generate di server (Next.js), dikirim ke sini sebagai snapshot
  -- Kalkulasi battle juga dilakukan di server, hasilnya dikirim ke sini untuk disimpan
  p_result    text,          -- 'win' | 'lose' (divalidasi via CHECK di arena_battles)
  p_opponent_snapshot jsonb, -- stat AI opponent untuk log/replay
  p_battle_log        jsonb  -- turn-by-turn log
)
returns jsonb                -- kembalikan { sig_reward, tickets_remaining }
language plpgsql
security definer
as $$
declare
  v_tickets        int;
  v_reset_at       timestamptz;
  v_monster_level  int;
  v_sig_reward     bigint;
  v_new_tickets    int;
  v_battle_id      uuid;
begin
  -- 1. Ambil state user dengan FOR UPDATE untuk mencegah race condition
  --    jika ada dua request battle yang masuk hampir bersamaan (double-tap, dll).
  select arena_tickets_remaining, arena_tickets_reset_at
  into v_tickets, v_reset_at
  from users
  where id = p_user_id
  for update;

  if not found then
    raise exception 'User tidak ditemukan.';
  end if;

  -- 2. Lazy reset: kalau tanggal UTC sudah berbeda dari reset_at, reset tiket ke 3
  if date(v_reset_at at time zone 'UTC') < current_date then
    v_tickets := 3;
    update users
    set arena_tickets_remaining = 3,
        arena_tickets_reset_at  = now()
    where id = p_user_id;
  end if;

  -- 3. Validasi tiket tersedia
  if v_tickets <= 0 then
    raise exception 'Tiket Arena habis hari ini. Kembali besok untuk 3 tiket baru.';
  end if;

  -- 4. Validasi level monster minimal 15 (Bitty+)
  select level into v_monster_level
  from monsters
  where id = p_monster_id and owner_id = p_user_id;

  if not found then
    raise exception 'Monster tidak ditemukan atau bukan milik kamu.';
  end if;

  if v_monster_level < 15 then
    raise exception 'Monster harus minimal Level 15 (Bitty) untuk masuk Arena.';
  end if;

  -- 5. Validasi result value
  if p_result not in ('win', 'lose') then
    raise exception 'Hasil battle tidak valid.';
  end if;

  -- 6. Hardcode reward (tidak bisa dimanipulasi dari luar)
  v_sig_reward := case p_result
    when 'win'  then 50
    when 'lose' then 20
    else 0
  end;

  -- 7. Insert battle log
  insert into arena_battles (owner_id, monster_id, opponent_snapshot, result, sig_reward, battle_log)
  values (p_user_id, p_monster_id, p_opponent_snapshot, p_result, v_sig_reward, p_battle_log)
  returning id into v_battle_id;

  -- 8. Kurangi tiket dan tambah SIG secara atomik
  v_new_tickets := v_tickets - 1;
  update users
  set sig_balance             = sig_balance + v_sig_reward,
      arena_tickets_remaining = v_new_tickets
  where id = p_user_id;

  return jsonb_build_object(
    'battle_id',         v_battle_id,
    'sig_reward',        v_sig_reward,
    'tickets_remaining', v_new_tickets,
    'result',            p_result
  );
end;
$$;

-- ── Permission: Restrict EXECUTE ke service_role saja ──────────────────────────
-- Postgres secara default grant EXECUTE ke PUBLIC untuk setiap fungsi baru.
-- Kita cabut dan hanya izinkan service_role (dipakai oleh Next.js server-side)
-- sehingga anon key dari browser tidak bisa memanggil fungsi ini langsung.
revoke execute on function battle_arena(uuid, uuid, text, jsonb, jsonb) from public;
grant  execute on function battle_arena(uuid, uuid, text, jsonb, jsonb) to service_role;
