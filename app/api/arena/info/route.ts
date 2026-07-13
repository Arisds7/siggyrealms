export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get("wallet");

    if (!wallet) {
      return NextResponse.json({ error: "wallet parameter is required." }, { status: 400 });
    }

    const supabase = createServiceClient();

    // 1. Ambil user + tiket
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, sig_balance, arena_tickets_remaining, arena_tickets_reset_at")
      .ilike("wallet_address", wallet)
      .maybeSingle();

    if (userErr || !user) {
      return NextResponse.json({ error: "Wallet not found in the Codex. Please bind your wallet first." }, { status: 404 });
    }

    // Lazy-reset tiket (mirror logika di RPC) untuk tampilan yang akurat
    let tickets = user.arena_tickets_remaining;
    const resetDate = new Date(user.arena_tickets_reset_at).toISOString().split("T")[0];
    const today = new Date().toISOString().split("T")[0];
    if (resetDate < today) {
      tickets = 3;
      // Update DB agar konsisten (best-effort, RPC juga akan reset saat battle)
      await supabase
        .from("users")
        .update({ arena_tickets_remaining: 3, arena_tickets_reset_at: new Date().toISOString() })
        .eq("id", user.id);
    }

    // 2. Ambil monster terbaik (urutan level tertinggi) milik user untuk preview
    const { data: monsters, error: monErr } = await supabase
      .from("monsters")
      .select(`
        id, level, evolution_stage, species_key, nickname,
        species!inner ( name, element, role ),
        monster_stats!inner ( hp, atk, def, spd, crit, dodge ),
        monster_food_bonus!inner ( hp_bonus, atk_bonus, def_bonus, spd_bonus, crit_bonus, dodge_bonus )
      `)
      .eq("owner_id", user.id)
      .order("level", { ascending: false });

    if (monErr) {
      return NextResponse.json({ error: monErr.message }, { status: 500 });
    }

    // 3. Ambil 5 battle terbaru
    const { data: recentBattles, error: battleErr } = await supabase
      .from("arena_battles")
      .select("id, result, sig_reward, opponent_snapshot, created_at")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5);

    if (battleErr) {
      return NextResponse.json({ error: battleErr.message }, { status: 500 });
    }

    return new NextResponse(
      JSON.stringify({
        sig_balance:        user.sig_balance,
        tickets_remaining:  tickets,
        tickets_max:        3,
        monsters:           monsters ?? [],
        recent_battles:     recentBattles ?? [],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      }
    );
  } catch (err: any) {
    console.error("[arena/info] Error:", err);
    return NextResponse.json(
      { error: err.message ?? "An internal disturbance struck the Arena. Please try again." },
      { status: 500 }
    );
  }
}
