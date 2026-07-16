import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth/session";

const ALLOWED_DAILY = ["login", "tap", "feed"];
const ALLOWED_LIMITED = ["follow", "like", "retweet"];

export async function POST(req: NextRequest) {
  try {
    // ── Auth: read wallet from SIWE session cookie ───────────────────────────
    let walletAddress: string;
    try {
      walletAddress = await requireAuth();
    } catch {
      return NextResponse.json(
        { error: "Unauthorized. Please authenticate before claiming quest rewards." },
        { status: 401 }
      );
    }

    const { type, questKey } = await req.json();

    if (!type || !questKey) {
      return NextResponse.json(
        { error: "type and questKey are required for the ritual." },
        { status: 400 }
      );
    }

    if (type !== "daily" && type !== "limited") {
      return NextResponse.json(
        { error: "Type must be 'daily' or 'limited'." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 1. Seek summoner in the Codex
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, sig_balance")
      .ilike("wallet_address", walletAddress)
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Wallet not found in the Codex." },
        { status: 404 }
      );
    }

    // 2. Execute claim atomically via RPC (reward is hardcoded at DB level)
    if (type === "daily") {
      if (!ALLOWED_DAILY.includes(questKey)) {
        return NextResponse.json({ error: "Daily quest not valid." }, { status: 400 });
      }

      const { error: rpcError } = await supabase.rpc("claim_daily_quest", {
        p_user_id: user.id,
        p_quest_type: questKey,
      });

      if (rpcError) {
        return NextResponse.json({ error: rpcError.message }, { status: 400 });
      }
    } else {
      if (!ALLOWED_LIMITED.includes(questKey)) {
        return NextResponse.json({ error: "Limited task not valid." }, { status: 400 });
      }

      const { error: rpcError } = await supabase.rpc("claim_limited_task", {
        p_user_id: user.id,
        p_task_type: questKey,
      });

      if (rpcError) {
        return NextResponse.json({ error: rpcError.message }, { status: 400 });
      }
    }

    // 3. Fetch latest SIG balance to sync to frontend
    const { data: updatedUser } = await supabase
      .from("users")
      .select("sig_balance")
      .eq("id", user.id)
      .single();

    return NextResponse.json({
      success: true,
      sig_balance: updatedUser?.sig_balance ?? user.sig_balance,
      message: `Reward for ${questKey} has been channelled to your Vault!`,
    });
  } catch (err: any) {
    console.error("[api/quest/claim] Error:", err);
    return NextResponse.json(
      { error: err.message ?? "An internal tremor disrupted the ritual." },
      { status: 500 }
    );
  }
}
