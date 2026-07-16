import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/session";

/**
 * POST /api/shop/buy
 * Body: { foodKey: string, quantity: number }
 *
 * Validates SIG balance, deducts cost, and updates inventory atomically
 * via Postgres RPC `buy_item` (with row-level FOR UPDATE locking).
 */
export async function POST(req: NextRequest) {
  try {
    // ── Auth: read wallet from SIWE session cookie ───────────────────────────
    let walletAddress: string;
    try {
      walletAddress = await requireAuth();
    } catch {
      return NextResponse.json(
        { error: "Unauthorized. Please authenticate before making purchases." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { foodKey, quantity } = body as {
      foodKey?: string;
      quantity?: number;
    };

    // ── Input validation ────────────────────────────────────────────────────
    if (!foodKey || !quantity) {
      return NextResponse.json(
        { error: "foodKey and quantity are required." },
        { status: 400 }
      );
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json(
        { error: "Quantity must be an integer of at least 1." },
        { status: 400 }
      );
    }
    if (quantity > 99) {
      return NextResponse.json(
        { error: "Maximum purchase is 99 items at once." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // ── Look up user ────────────────────────────────────────────────────────
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

    // ── Execute buy_item RPC atomically ─────────────────────────────────────
    const { data: rpcData, error: rpcErr } = await supabase.rpc("buy_item", {
      p_user_id:  user.id,
      p_food_key: foodKey,
      p_quantity: quantity,
    });

    if (rpcErr || !rpcData) {
      console.error("[shop/buy] RPC error:", rpcErr);
      return NextResponse.json(
        { error: rpcErr?.message ?? "Failed to process payment." },
        { status: 500 }
      );
    }

    const result = rpcData as {
      success:      boolean;
      food_name:    string;
      new_balance:  number;
      new_quantity: number;
    };

    return NextResponse.json({
      success:         true,
      food_key:        foodKey,
      food_name:       result.food_name,
      quantity_bought: quantity,
      new_quantity:    result.new_quantity,
      sig_balance:     result.new_balance,
    });
  } catch (err: any) {
    console.error("[shop/buy] Unexpected error:", err);
    return NextResponse.json(
      { error: err.message ?? "An internal disturbance prevented the purchase." },
      { status: 500 }
    );
  }
}
