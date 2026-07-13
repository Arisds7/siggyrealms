import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const ALLOWED_DAILY = ["login", "tap", "feed"];
const ALLOWED_LIMITED = ["follow", "like", "retweet"];

export async function POST(req: NextRequest) {
  try {
    const { walletAddress, type, questKey } = await req.json();

    if (!walletAddress || !type || !questKey) {
      return NextResponse.json(
        { error: "walletAddress, type, dan questKey wajib diisi." },
        { status: 400 }
      );
    }

    if (type !== "daily" && type !== "limited") {
      return NextResponse.json(
        { error: "Type harus berupa 'daily' atau 'limited'." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 1. Cari user di database
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, sig_balance")
      .ilike("wallet_address", walletAddress)
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Wallet tidak terdaftar di Codex." },
        { status: 404 }
      );
    }

    // 2. Eksekusi klaim secara atomic via RPC (reward di-hardcode di level DB)
    if (type === "daily") {
      if (!ALLOWED_DAILY.includes(questKey)) {
        return NextResponse.json({ error: "Quest harian tidak valid." }, { status: 400 });
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
        return NextResponse.json({ error: "Task limited tidak valid." }, { status: 400 });
      }

      const { error: rpcError } = await supabase.rpc("claim_limited_task", {
        p_user_id: user.id,
        p_task_type: questKey,
      });

      if (rpcError) {
        return NextResponse.json({ error: rpcError.message }, { status: 400 });
      }
    }

    // 3. Ambil balance SIG terbaru untuk di-sync ke frontend
    const { data: updatedUser } = await supabase
      .from("users")
      .select("sig_balance")
      .eq("id", user.id)
      .single();

    return NextResponse.json({
      success: true,
      sig_balance: updatedUser?.sig_balance ?? user.sig_balance,
      message: `Berhasil mengklaim reward untuk ${questKey}!`,
    });
  } catch (err: any) {
    console.error("[api/quest/claim] Error:", err);
    return NextResponse.json(
      { error: err.message ?? "Terjadi kesalahan internal." },
      { status: 500 }
    );
  }
}
