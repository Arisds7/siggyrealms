import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/session";
import {
  canEvolveToNextStage,
  EVOLUTION_STAT_MULTIPLIER,
  type EvolutionStage,
} from "@/lib/constants/evolutionThresholds";

export async function POST(req: NextRequest) {
  try {
    // ── Auth: read wallet from SIWE session cookie ───────────────────────────
    let walletAddress: string;
    try {
      walletAddress = await requireAuth();
    } catch {
      return NextResponse.json(
        { error: "Unauthorized. Please authenticate before beginning the evolution ritual." },
        { status: 401 }
      );
    }

    const { monsterId } = await req.json();

    if (!monsterId) {
      return NextResponse.json(
        { error: "monsterId is required to begin the evolution ritual." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 1. Ambil user berdasarkan walletAddress
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id")
      .ilike("wallet_address", walletAddress)
      .maybeSingle();

    if (userErr || !user) {
      return NextResponse.json(
        { error: "Wallet not found in the Codex. Please bind your wallet first." },
        { status: 404 }
      );
    }

    // 2. Fetch monster + owner SIG balance, verifying ownership
    const { data: monster, error: fetchError } = await supabase
      .from("monsters")
      .select(
        "id, level, evolution_stage, owner_id, users!inner(id, sig_balance)"
      )
      .eq("id", monsterId)
      .eq("owner_id", user.id)
      .single();

    if (fetchError || !monster) {
      return NextResponse.json(
        { error: "Entity not found or does not belong to your Vault." },
        { status: 404 }
      );
    }

    const owner = Array.isArray(monster.users)
      ? monster.users[0]
      : (monster.users as { id: string; sig_balance: number });

    // 3. Check level eligibility via shared helper (keeps boundary in one place)
    const nextStage = canEvolveToNextStage(
      monster.evolution_stage as EvolutionStage,
      monster.level
    );

    if (!nextStage) {
      // Determine what level is needed for the next stage to give a useful error
      const stageIndex = ["initiate", "bitty", "ritty", "ritualist", "radiant_ritualist"].indexOf(
        monster.evolution_stage
      );
      if (stageIndex >= 4) {
        return NextResponse.json(
          { error: "This entity has already reached its highest form. No further ascension is possible." },
          { status: 400 }
        );
      }
      return NextResponse.json(
        {
          error: `The entity's level is insufficient for the next stage of ascension.`,
        },
        { status: 400 }
      );
    }

    // 4. Check SIG balance
    if (owner.sig_balance < nextStage.evolveCostSig) {
      return NextResponse.json(
        {
          error: `Insufficient SIG to perform the evolution ritual. Needed: ${nextStage.evolveCostSig} SIG, you have: ${owner.sig_balance} SIG.`,
        },
        { status: 400 }
      );
    }

    // 5. Execute evolve atomically via Postgres RPC (verified ownership & current stage)
    const { data: result, error: rpcError } = await supabase.rpc(
      "evolve_monster",
      {
        p_monster_id:       monsterId,
        p_owner_id:         owner.id,
        p_current_stage:    monster.evolution_stage,
        p_next_stage:       nextStage.stage,
        p_cost_sig:         nextStage.evolveCostSig,
        p_reward_sig:       nextStage.evolveRewardSig,
        p_stat_multiplier:  EVOLUTION_STAT_MULTIPLIER,
      }
    );

    if (rpcError) {
      console.error("[evolve] RPC error:", rpcError);
      return NextResponse.json(
        { error: rpcError.message ?? "The evolution ritual collapsed. Check your SIG and entity status." },
        { status: 500 }
      );
    }

    // 5. Return fresh state to the client
    const { data: freshMonster, error: freshErr } = await supabase
      .from("monsters")
      .select(
        `id, level, evolution_stage, energy, exp, satiety, nickname, species_key,
         species!inner(key, name, element, role),
         monster_stats!inner(hp, atk, def, spd, crit, dodge),
         monster_food_bonus!inner(hp_bonus, atk_bonus, def_bonus, spd_bonus, crit_bonus, dodge_bonus)`
      )
      .eq("id", monsterId)
      .single();

    const { data: freshUser } = await supabase
      .from("users")
      .select("sig_balance")
      .eq("id", owner.id)
      .single();

    if (freshErr || !freshMonster) {
      // Evolve succeeded but re-fetch failed — still report success with partial data
      return NextResponse.json({
        success: true,
        newStage: nextStage.stage,
        netSigChange: nextStage.evolveRewardSig - nextStage.evolveCostSig,
        monster: null,
        sig_balance: freshUser?.sig_balance ?? null,
      });
    }

    return NextResponse.json({
      success:      true,
      newStage:     nextStage.stage,
      netSigChange: nextStage.evolveRewardSig - nextStage.evolveCostSig,
      monster:      freshMonster,
      sig_balance:  freshUser?.sig_balance ?? null,
    });
  } catch (err: any) {
    console.error("[evolve] Unexpected error:", err);
    return NextResponse.json(
      { error: err.message ?? "An internal disturbance disrupted the evolution ritual." },
      { status: 500 }
    );
  }
}
