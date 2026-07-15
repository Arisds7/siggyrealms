export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * GET /api/user/stats
 *
 * Auth pattern: wallet address taken from query param `wallet`,
 * identical to all other endpoints in this codebase (/api/arena/info,
 * /api/quest/list, /api/monster/list). Wallet comes from localStorage
 * set during login — this is the agreed testnet auth model
 * across the entire codebase.
 *
 * What is NOT done here:
 * - Does not accept user_id as param (user could spoof another's ID)
 * - Does not return other users' data (query is ilike by wallet, 1 row only)
 * - Does not accept sig_balance override from client
 *
 * Lazy ticket reset: identical to logic in /api/arena/info —
 * reset performed just-in-time if reset_at < today UTC.
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

    // Fetch user by wallet address (case-insensitive)
    // ilike ensures "0xABC" == "0xabc" — consistent with all other endpoints
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

    // ── Lazy ticket reset (just-in-time, not cron) ──────────────────────────
    // Design: tickets reset daily at UTC midnight lazily,
    // i.e. checked per-request not via scheduled job.
    let tickets = user.arena_tickets_remaining;
    const resetDate = new Date(user.arena_tickets_reset_at).toISOString().split("T")[0];
    const today    = new Date().toISOString().split("T")[0];

    if (resetDate < today) {
      tickets = 3;
      // Best-effort update — RPC battle will also reset during next battle
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
          // Must be no-store to prevent browser from caching old values
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
