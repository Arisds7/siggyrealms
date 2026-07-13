import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const wallet = searchParams.get("wallet");

  if (!wallet) {
    return NextResponse.json(
      { error: "Missing wallet query param" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  // 1. Find user by wallet address
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, sig_balance, twitter_handle")
    .ilike("wallet_address", wallet)
    .maybeSingle();

  if (userError) {
    return NextResponse.json({ error: userError.message }, { status: 500 });
  }

  if (!user) {
    return NextResponse.json(
      { error: "User not found. Please complete the ritual first." },
      { status: 404 }
    );
  }

  // 2. Fetch all monsters with stats, food bonus, and species info
  const { data: monsters, error: monsterError } = await supabase
    .from("monsters")
    .select(`
      id,
      nickname,
      token_id,
      level,
      exp,
      evolution_stage,
      energy,
      satiety,
      species_key,
      species!inner (
        key,
        name,
        element,
        role
      ),
      monster_stats!inner (
        hp,
        atk,
        def,
        spd,
        crit,
        dodge
      ),
      monster_food_bonus!inner (
        hp_bonus,
        atk_bonus,
        def_bonus,
        spd_bonus,
        crit_bonus,
        dodge_bonus
      )
    `)
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  if (monsterError) {
    return NextResponse.json({ error: monsterError.message }, { status: 500 });
  }

  // 3. Fetch user's inventory of food
  const { data: inventory, error: inventoryError } = await supabase
    .from("inventory")
    .select("food_key, quantity")
    .eq("owner_id", user.id);

  if (inventoryError) {
    return NextResponse.json({ error: inventoryError.message }, { status: 500 });
  }

  return NextResponse.json({
    sig_balance: user.sig_balance,
    twitter_handle: user.twitter_handle,
    monsters: monsters ?? [],
    inventory: inventory ?? [],
  });
}
