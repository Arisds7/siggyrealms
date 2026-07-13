export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

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

    // 1. Cari user di database
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, sig_balance")
      .ilike("wallet_address", wallet)
      .maybeSingle();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Wallet not found in the Codex. Please bind your wallet first." },
        { status: 404 }
      );
    }

    // 2. Lazy Reset / Just-in-Time initialization quest harian hari ini (UTC date)
    const todayStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format UTC

    // Upsert row kosong dengan ignoreDuplicates: true agar progress tap/feed tidak ter-reset
    const { error: initError } = await supabase
      .from("daily_quests")
      .upsert(
        { owner_id: user.id, quest_date: todayStr },
        { onConflict: "owner_id,quest_date", ignoreDuplicates: true }
      );

    if (initError) {
      console.error("Failed to initialize daily quest row:", initError);
    }

    // 3. Ambil progress quest harian hari ini
    const { data: dailyQuest, error: questError } = await supabase
      .from("daily_quests")
      .select("login_claimed, tap_count, tap_claimed, feed_claimed, fed_count")
      .eq("owner_id", user.id)
      .eq("quest_date", todayStr)
      .single();

    if (questError || !dailyQuest) {
      throw new Error(questError?.message ?? "Gagal mengambil data quest harian.");
    }

    // 4. Ambil limited tasks (one-time) yang sudah pernah diklaim user
    const { data: limitedTasks, error: limitedError } = await supabase
      .from("limited_tasks")
      .select("task_type")
      .eq("user_id", user.id);

    if (limitedError) {
      throw new Error(limitedError.message);
    }

    const completedLimited = limitedTasks ? limitedTasks.map((t) => t.task_type) : [];

    return NextResponse.json({
      sig_balance: user.sig_balance,
      daily_quests: {
        quest_date: todayStr,
        login: {
          progress: 1, // Login auto-completed jika row harian terinisialisasi
          target: 1,
          claimed: dailyQuest.login_claimed,
          reward: 50,
        },
        tap: {
          progress: dailyQuest.tap_count,
          target: 100,
          claimed: dailyQuest.tap_claimed,
          reward: 100,
        },
        feed: {
          progress: dailyQuest.fed_count,
          target: 1,
          claimed: dailyQuest.feed_claimed,
          reward: 50,
        },
      },
      limited_tasks: {
        follow: completedLimited.includes("follow"),
        like: completedLimited.includes("like"),
        retweet: completedLimited.includes("retweet"),
      },
    });
  } catch (err: any) {
    console.error("[api/quest/list] Error:", err);
    return NextResponse.json(
      { error: err.message ?? "Terjadi kesalahan internal." },
      { status: 500 }
    );
  }
}
