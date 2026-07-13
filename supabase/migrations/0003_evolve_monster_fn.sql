-- =========================================================
-- Migration 0003: evolve_monster() — atomic evolution RPC
-- Jalankan di Supabase SQL Editor atau via: supabase db push
-- =========================================================
--
-- Fungsi ini dipanggil oleh POST /api/monster/evolve dan
-- melakukan TIGA update dalam satu transaksi implisit PL/pgSQL:
--
--   a. Kurangi sig_balance owner sebesar p_cost_sig,
--      TAMBAH p_reward_sig (net change = reward - cost).
--      Net selalu positif sesuai GDD.
--
--   b. Kalikan semua kolom di monster_stats dengan p_stat_multiplier (1.5).
--      Kolom monster_food_bonus TIDAK disentuh sama sekali —
--      sesuai GDD: "Food bonus tidak ikut dikalikan."
--      Nilai dibulatkan ke integer (ROUND) kecuali crit & dodge (numeric).
--
--   c. Set monsters.evolution_stage = p_next_stage.
--
-- Karena semua statement ada dalam satu blok PL/pgSQL, kalau salah
-- satu RAISE EXCEPTION maka seluruh operasi di-rollback otomatis
-- oleh Postgres — tidak akan terjadi state setengah-setengah.

create or replace function evolve_monster(
  p_monster_id      uuid,
  p_owner_id        uuid,
  p_next_stage      text,
  p_cost_sig        bigint,
  p_reward_sig      bigint,
  p_stat_multiplier numeric
)
returns void
language plpgsql
security definer
as $$
begin
  -- a. Update SIG balance (net = reward - cost)
  update users
  set sig_balance = sig_balance - p_cost_sig + p_reward_sig
  where id = p_owner_id;

  if not found then
    raise exception 'User tidak ditemukan: %', p_owner_id;
  end if;

  -- b. Scale base stats — food_bonus columns intentionally excluded
  update monster_stats
  set
    hp    = round(hp    * p_stat_multiplier),
    atk   = round(atk   * p_stat_multiplier),
    def   = round(def   * p_stat_multiplier),
    spd   = round(spd   * p_stat_multiplier),
    crit  = round(crit  * p_stat_multiplier, 2),
    dodge = round(dodge * p_stat_multiplier, 2),
    updated_at = now()
  where monster_id = p_monster_id;

  if not found then
    raise exception 'monster_stats tidak ditemukan untuk monster: %', p_monster_id;
  end if;

  -- c. Update evolution stage on the monster row
  update monsters
  set evolution_stage = p_next_stage
  where id = p_monster_id;

  if not found then
    raise exception 'Monster tidak ditemukan: %', p_monster_id;
  end if;
end;
$$;
