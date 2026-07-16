export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/session";

/**
 * GET /api/user/stats
 *
 * Auth pattern: wallet address taken from verified SIWE session cookie.
 */
export async function GET(req: NextRequest) {
  try {
    // ── Auth: read wallet from SIWE session cookie ───────────────────────────
    let walletAddress: string;
    try {
      walletAddress = await requireAuth();
    } catch {
      return NextResponse.json(
        { error: "Unauthorized. Please authenticate first." },
        { status: 401 }
      );
    }

    const supabase = createServiceClient();

    // Fetch user by wallet address from session (case-insensitive)
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

    // ── Lazy ticket reset (just-in-time, not cron) ──────────────────────────
    let tickets = user.arena_tickets_remaining;
    const resetDate = new Date(user.arena_tickets_reset_at).toISOString().split("T")[0];
    const today    = new Date().toISOString().split("T")[0];

    if (resetDate < today) {
      tickets = 3;
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
