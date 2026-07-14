import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wallet = searchParams.get("wallet");

  if (!wallet) {
    return NextResponse.json({ error: "Missing wallet parameter" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // 1. Cari user di tabel users berdasarkan wallet_address
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, twitter_handle")
    .ilike("wallet_address", wallet)
    .maybeSingle();

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }

  // Jika user tidak ditemukan, berarti belum terdaftar
  if (!user) {
    return NextResponse.json({ exists: false, hasMonster: false, userId: null });
  }

  // 2. Cek apakah user memiliki monster di tabel monsters
  const { data: monster, error: monsterError } = await supabase
    .from("monsters")
    .select("id")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (monsterError) {
    return NextResponse.json({ error: monsterError.message }, { status: 500 });
  }

  return NextResponse.json({
    exists: true,
    hasMonster: !!monster,
    userId: user.id,
    twitter_handle: user.twitter_handle,
  });
}
