-- =========================================================
-- Migration 0004: feed_monster() — atomic feeding RPC
-- Jalankan di Supabase SQL Editor atau via: supabase db push
-- =========================================================

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
end;
$$;
