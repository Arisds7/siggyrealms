import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const { twitterHandle, walletAddress } = await req.json();

  if (!twitterHandle || !walletAddress) {
    return NextResponse.json(
      { error: "twitterHandle dan walletAddress wajib diisi." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // upsert: kalau wallet_address sudah ada, jangan bikin user baru
  // (biar user lama tetap bisa "login" ulang tanpa data ke-reset).
  const { data, error } = await supabase
    .from("users")
    .upsert(
      { wallet_address: walletAddress.toLowerCase(), twitter_handle: twitterHandle },
      { onConflict: "wallet_address", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data });
}
