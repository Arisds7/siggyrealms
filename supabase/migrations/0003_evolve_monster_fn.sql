-- =========================================================
-- Migration 0003: evolve_monster() — atomic evolution RPC
-- Run in Supabase SQL Editor or via: supabase db push
-- =========================================================
--
-- This function is called by POST /api/monster/evolve and
-- performs THREE updates in one implicit PL/pgSQL transaction:
--
--   a. Deduct owner sig_balance by p_cost_sig,
--      ADD p_reward_sig (net change = reward - cost).
--      Net is always positive per GDD.
--
--   b. Multiply all columns in monster_stats by p_stat_multiplier (1.5).
--      monster_food_bonus columns are NOT touched at all —
--      per GDD: "Food bonus tidak ikut dikalikan."
--      Values rounded to integer (ROUND) except crit & dodge (numeric).
--
--   c. Set monsters.evolution_stage = p_next_stage.
--
-- Since all statements are in one PL/pgSQL block, if any
-- one RAISE EXCEPTION then the entire operation is auto-rollbacked
-- by Postgres — no half-state will occur.

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
    raise exception 'User not found: %', p_owner_id;
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
    raise exception 'monster_stats not found for entity: %', p_monster_id;
  end if;

  -- c. Update evolution stage on the monster row
  update monsters
  set evolution_stage = p_next_stage
  where id = p_monster_id;

  if not found then
    raise exception 'Entity not found: %', p_monster_id;
  end if;
end;
$$;
