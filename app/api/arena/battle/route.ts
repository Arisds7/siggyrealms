import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { SPECIES, SPECIES_KEYS } from "@/lib/constants/monsterBaseStats";
import type { Element } from "@/lib/constants/monsterBaseStats";
import { runBattle } from "@/lib/game-logic/battleFormula";
import type { CombatantStats } from "@/lib/game-logic/battleFormula";
import { EVOLUTION_STAT_MULTIPLIER } from "@/lib/constants/evolutionThresholds";

// ─── Opponent Generation ──────────────────────────────────────────────────────
// Approach A: Deterministic dummy monster scaled from species base stats.
// Level = player level ± small variance. Element = purely random.
// Stats are scaled to mirror natural discrete player evolution stage multiplier plus variance.

function generateOpponent(playerStats: CombatantStats, playerLevel: number): CombatantStats & { level: number } {
  // Level variance: -3 to +5 from player level, min 15 (since player min is 15)
  const variance = Math.floor(Math.random() * 9) - 3; // -3..+5
  const opponentLevel = Math.max(15, playerLevel + variance);

  // Pick a random species as the base
  const speciesKey = SPECIES_KEYS[Math.floor(Math.random() * SPECIES_KEYS.length)];
  const species = SPECIES[speciesKey];

  // Pick a random element (may or may not match species's natural element)
  const ELEMENTS: Element[] = ["fire", "water", "nature", "lightning", "dark"];
  const element = ELEMENTS[Math.floor(Math.random() * ELEMENTS.length)];

  // Opsi A: Dynamic Scale-to-Player
  // Opponent stats are generated directly scaling from the player's stats to guarantee balanced combat
  const hpVariance   = 0.95 + Math.random() * 0.15; // 0.95 s.d 1.10
  const atkVariance  = 0.90 + Math.random() * 0.15; // 0.90 s.d 1.05
  const defVariance  = 0.90 + Math.random() * 0.15; // 0.90 s.d 1.05
  const spdVariance  = 0.90 + Math.random() * 0.20; // 0.90 s.d 1.10
  const critVariance = 0.90 + Math.random() * 0.20; // 0.90 s.d 1.10
  const dodgeVariance= 0.90 + Math.random() * 0.20; // 0.90 s.d 1.10

  return {
    name: `Shadow ${species.name}`,
    element,
    level: opponentLevel,
    hp:    Math.max(100, Math.round(playerStats.hp    * hpVariance)),
    atk:   Math.max(10,  Math.round(playerStats.atk   * atkVariance)),
    def:   Math.max(10,  Math.round(playerStats.def   * defVariance)),
    spd:   Math.max(10,  Math.round(playerStats.spd   * spdVariance)),
    crit:  Math.min(Math.max(1, Math.round(playerStats.crit  * critVariance)), 50),
    dodge: Math.min(Math.max(1, Math.round(playerStats.dodge * dodgeVariance)), 40),
  };
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { walletAddress, monsterId } = await req.json();

    if (!walletAddress || !monsterId) {
      return NextResponse.json(
        { error: "walletAddress and monsterId are required to begin the ritual." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 1. Ambil user
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, sig_balance, arena_tickets_remaining, arena_tickets_reset_at")
      .ilike("wallet_address", walletAddress)
      .maybeSingle();

    if (userErr || !user) {
      return NextResponse.json(
        { error: "Wallet not found in the Codex. Please bind your wallet first." },
        { status: 404 }
      );
    }

    // 2. Ambil stat monster pemain (base + food bonus digabungkan untuk combat)
    const { data: monster, error: monsterErr } = await supabase
      .from("monsters")
      .select(`
        id, level, evolution_stage, species_key,
        species!inner ( element ),
        monster_stats!inner ( hp, atk, def, spd, crit, dodge ),
        monster_food_bonus!inner ( hp_bonus, atk_bonus, def_bonus, spd_bonus, crit_bonus, dodge_bonus )
      `)
      .eq("id", monsterId)
      .eq("owner_id", user.id)
      .single();

    if (monsterErr || !monster) {
      return NextResponse.json(
        { error: "Entity not found or does not belong to your Vault." },
        { status: 404 }
      );
    }

    // Pre-flight level check (also enforced inside RPC)
    if (monster.level < 15) {
      return NextResponse.json(
        { error: "Your Siggy must reach Level 15 (Bitty) before entering the Arena." },
        { status: 400 }
      );
    }

    // 3. Build player combatant (base + food bonus)
    const ms  = monster.monster_stats as any;
    const mfb = monster.monster_food_bonus as any;
    const sp  = monster.species as any;

    const playerStats: CombatantStats = {
      name:  monster.species_key,
      element: sp.element as Element,
      hp:    ms.hp    + mfb.hp_bonus,
      atk:   ms.atk   + mfb.atk_bonus,
      def:   ms.def   + mfb.def_bonus,
      spd:   ms.spd   + mfb.spd_bonus,
      crit:  Number(ms.crit)  + Number(mfb.crit_bonus),
      dodge: Number(ms.dodge) + Number(mfb.dodge_bonus),
    };

    // 4. Generate opponent (balanced dynamically to player stats)
    const opponentRaw = generateOpponent(playerStats, monster.level);
    const opponentStats: CombatantStats = {
      name:    opponentRaw.name,
      element: opponentRaw.element,
      hp:      opponentRaw.hp,
      atk:     opponentRaw.atk,
      def:     opponentRaw.def,
      spd:     opponentRaw.spd,
      crit:    opponentRaw.crit,
      dodge:   opponentRaw.dodge,
    };

    // 5. Run battle (pure function — no DB touch)
    const battleResult = runBattle(playerStats, opponentStats);
    const result: "win" | "lose" = battleResult.winner === "player" ? "win" : "lose";

    // 6. Commit to DB via atomic RPC (validates tickets + level again, adds SIG)
    const { data: rpcData, error: rpcErr } = await supabase.rpc("battle_arena", {
      p_user_id:           user.id,
      p_monster_id:        monsterId,
      p_result:            result,
      p_opponent_snapshot: {
        name:    opponentRaw.name,
        level:   opponentRaw.level,
        element: opponentRaw.element,
        hp:      opponentRaw.hp,
        atk:     opponentRaw.atk,
        def:     opponentRaw.def,
        spd:     opponentRaw.spd,
        crit:    opponentRaw.crit,
        dodge:   opponentRaw.dodge,
      },
      p_battle_log: {
        turns: battleResult.turns,
        total_turns: battleResult.totalTurns,
        player_element:   playerStats.element,
        opponent_element: opponentStats.element,
      },
    });

    if (rpcErr) {
      return NextResponse.json({ error: rpcErr.message }, { status: 400 });
    }

    const rpc = rpcData as {
      battle_id: string;
      sig_reward: number;
      tickets_remaining: number;
      result: string;
    };

    return NextResponse.json({
      success:           true,
      result,
      sig_reward:        rpc.sig_reward,
      tickets_remaining: rpc.tickets_remaining,
      battle_log:        battleResult.turns,
      total_turns:       battleResult.totalTurns,
      player: {
        element: playerStats.element,
        hp:      playerStats.hp,
      },
      opponent: {
        name:    opponentRaw.name,
        level:   opponentRaw.level,
        element: opponentRaw.element,
        hp:      opponentRaw.hp,
      },
    });
  } catch (err: any) {
    console.error("[arena/battle] Error:", err);
    return NextResponse.json(
      { error: err.message ?? "An internal disturbance prevented the Arena ritual." },
      { status: 500 }
    );
  }
}
