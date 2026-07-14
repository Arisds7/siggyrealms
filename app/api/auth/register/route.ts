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
  const normalizedWallet = walletAddress.toLowerCase();

  // Cek apakah wallet sudah terdaftar
  const { data: existingUser, error: fetchError } = await supabase
    .from("users")
    .select("id, twitter_handle")
    .ilike("wallet_address", normalizedWallet)
    .maybeSingle();

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  // Kalau wallet sudah ada, jangan update twitter_handle
  if (existingUser) {
    return NextResponse.json({ user: existingUser });
  }

  // Wallet baru: insert dengan twitter_handle yang dikirim
  const { data, error } = await supabase
    .from("users")
    .insert({
      wallet_address: normalizedWallet,
      twitter_handle: twitterHandle,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ user: data });
}
