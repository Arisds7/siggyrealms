import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/session";
import { expToLevel } from "@/lib/game-logic/expCalculator";

const EXP_PER_TAP = 10;

export async function POST(req: NextRequest) {
  try {
    // ── Auth: read wallet from SIWE session cookie ───────────────────────────
    let walletAddress: string;
    try {
      walletAddress = await requireAuth();
    } catch {
      return NextResponse.json(
        { error: "Unauthorized. Please authenticate before channelling the ritual." },
        { status: 401 }
      );
    }

    const { monsterId, count = 1 } = await req.json();

    if (!monsterId) {
      return NextResponse.json(
        { error: "monsterId is required to channel the ritual." },
        { status: 400 }
      );
    }

    const tapCount = Math.max(1, parseInt(count) || 1);

    const supabase = createServiceClient();

    // 1. Ambil user berdasarkan walletAddress dari session
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

    // 2. Ambil state monster saat ini dan pastikan kepemilikannya
    const { data: monster, error: fetchError } = await supabase
      .from("monsters")
      .select("id, energy, exp, level, evolution_stage, owner_id")
      .eq("id", monsterId)
      .eq("owner_id", user.id)
      .single();

    if (fetchError || !monster) {
      return NextResponse.json(
        { error: "Entity not found or does not belong to your Vault." },
        { status: 404 }
      );
    }

    // 3. Validasi energy
    if (monster.energy < 1) {
      return NextResponse.json(
        { error: "Your Siggy is exhausted. Wait for its energy to regenerate." },
        { status: 400 }
      );
    }

    // Cap tapCount ke sisa energy monster
    const actualTaps = Math.min(tapCount, monster.energy);

    if (actualTaps < 1) {
      return NextResponse.json(
        { error: "Your Siggy is exhausted. Wait for its energy to regenerate." },
        { status: 400 }
      );
    }

    // 4. Hitung nilai baru
    const newEnergy = monster.energy - actualTaps;
    const newExp    = monster.exp + (actualTaps * EXP_PER_TAP);

    // Level dihitung dari formula terpusat — evolution_stage TIDAK diubah di sini.
    // Evolusi tetap manual (player klik Evolve + bayar SIG) sesuai GDD.
    const newLevel  = expToLevel(newExp);

    // 5. Update database
    const { data: updated, error: updateError } = await supabase
      .from("monsters")
      .update({
        energy: newEnergy,
        exp:    newExp,
        level:  newLevel,
      })
      .eq("id", monsterId)
      .select("id, energy, exp, level, evolution_stage")
      .single();

    if (updateError || !updated) {
      throw new Error(updateError?.message ?? "Failed to update entity state.");
    }

    // 6. Increment daily quest tap count atomically on database
    const { error: questError } = await supabase.rpc("increment_daily_tap", {
      p_user_id: monster.owner_id,
      p_count: actualTaps,
    });
    if (questError) {
      console.error("Failed to increment daily tap quest count:", questError);
    }

    return NextResponse.json({
      success:  true,
      levelUp:  newLevel > monster.level,
      monster: {
        id:              updated.id,
        energy:          updated.energy,
        exp:             updated.exp,
        level:           updated.level,
        evolution_stage: updated.evolution_stage,
      },
    });
  } catch (err: any) {
    console.error("Tap API error:", err);
    return NextResponse.json(
      { error: err.message ?? "An internal tremor struck during the ritual." },
      { status: 500 }
    );
  }
}
