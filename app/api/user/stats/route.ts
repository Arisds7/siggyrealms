export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/user/stats
 *
 * Auth pattern: wallet address diambil dari query param `wallet`,
 * identik dengan semua endpoint lain di codebase ini (/api/arena/info,
 * /api/quest/list, /api/monster/list). Wallet berasal dari localStorage
 * yang di-set saat login — ini adalah auth model testnet yang sudah
 * disepakati di seluruh codebase.
 *
 * Yang TIDAK dilakukan di sini:
 * - Tidak menerima user_id sebagai param (user bisa spoof ID orang lain)
 * - Tidak return data user lain (query di-ilike oleh wallet, 1 row only)
 * - Tidak menerima sig_balance override dari client
 *
 * Lazy ticket reset: sama persis dengan logika di /api/arena/info —
 * reset dilakukan just-in-time jika reset_at < today UTC.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const wallet = searchParams.get("wallet");

    if (!wallet) {
      return NextResponse.json(
        { error: "wallet parameter is required." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // Ambil user berdasarkan wallet address (case-insensitive)
    // ilike memastikan "0xABC" == "0xabc" — konsisten dengan semua endpoint lain
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, sig_balance, arena_tickets_remaining, arena_tickets_reset_at")
      .ilike("wallet_address", wallet)
      .maybeSingle();

    if (userErr || !user) {
      return NextResponse.json(
        { error: "Wallet not found in the Codex. Please bind your wallet first." },
        { status: 404 }
      );
    }

    // ── Lazy ticket reset (just-in-time, bukan cron) ──────────────────────────
    // Desain: tiket direset setiap hari UTC midnight secara lazy,
    // yaitu dicek per-request bukan via scheduled job.
    let tickets = user.arena_tickets_remaining;
    const resetDate = new Date(user.arena_tickets_reset_at).toISOString().split("T")[0];
    const today    = new Date().toISOString().split("T")[0];

    if (resetDate < today) {
      tickets = 3;
      // Best-effort update — RPC battle juga akan reset saat battle berikutnya
      await supabase
        .from("users")
        .update({
          arena_tickets_remaining: 3,
          arena_tickets_reset_at:  new Date().toISOString(),
        })
        .eq("id", user.id);
    }

    return new NextResponse(
      JSON.stringify({
        sig_balance:       user.sig_balance,
        arena_tickets:     tickets,
        arena_tickets_max: 3,
      }),
      {
        status: 200,
        headers: {
          "Content-Type":  "application/json",
          // Wajib no-store agar browser tidak cache nilai lama
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma":        "no-cache",
          "Expires":       "0",
        },
      }
    );
  } catch (err: any) {
    console.error("[user/stats] Error:", err);
    return NextResponse.json(
      { error: err.message ?? "An internal tremor prevented syncing your stats." },
      { status: 500 }
    );
  }
}
