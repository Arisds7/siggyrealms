import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/monster/feed
 * Body: { monsterId: string, foodKey: string }
 *
 * Mengambil detail food dari tabel foods (effect_stat, effect_value, satiety_cost),
 * cek inventory & satiety, lalu jalankan feeding atomis via Postgres RPC.
 */
export async function POST(req: NextRequest) {
  try {
    const { walletAddress, monsterId, foodKey } = await req.json();

    if (!walletAddress || !monsterId || !foodKey) {
      return NextResponse.json(
        { error: "walletAddress, monsterId, and foodKey are required to perform the feeding ritual." },
        { status: 400 }
      );
    }

    const supabase = createServiceClient();

    // 1. Ambil detail food dari database (sumber kebenaran tunggal)
    const { data: food, error: foodErr } = await supabase
      .from("foods")
      .select("key, name, effect_stat, effect_value, satiety_cost")
      .eq("key", foodKey)
      .maybeSingle();

    if (foodErr || !food) {
      return NextResponse.json(
        { error: `Unknown offering type "${foodKey}" — not found in the Realm's Codex.` },
        { status: 404 }
      );
    }

    // 1.5. Ambil user berdasarkan walletAddress
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

    // 2. Ambil data monster (satiety + owner_id) dan verifikasi kepemilikan
    const { data: monster, error: fetchErr } = await supabase
      .from("monsters")
      .select("id, owner_id, satiety")
      .eq("id", monsterId)
      .eq("owner_id", user.id)
      .single();

    if (fetchErr || !monster) {
      return NextResponse.json(
        { error: "Entity not found or does not belong to your Vault." },
        { status: 404 }
      );
    }

    // 3. Cek inventory langsung di sini untuk error message yang lebih informatif
    //    (RPC juga akan cek, tapi error dari RAISE EXCEPTION lebih sulit dikustomisasi)
    const { data: invRow } = await supabase
      .from("inventory")
      .select("quantity")
      .eq("owner_id", monster.owner_id)
      .eq("food_key", foodKey)
      .maybeSingle();

    if (!invRow || invRow.quantity < 1) {
      return NextResponse.json(
        { error: `This offering is not in your Vault. Acquire it from the Bazaar first.` },
        { status: 400 }
      );
    }

    // 4. Cek satiety sebelum RPC untuk error message yang jelas ke frontend
    if (monster.satiety < food.satiety_cost) {
      return NextResponse.json(
        {
          error: `Your Siggy's satiety is too low (${monster.satiety}/${food.satiety_cost}). Wait for it to recover.`,
        },
        { status: 400 }
      );
    }

    // 5. Jalankan feeding atomis via Postgres RPC
    //    RPC menangani: inventory decrement, satiety decrement, monster_food_bonus increment
    //    dalam satu implicit transaction — lihat migrations/0004_feed_monster_fn.sql
    const { error: rpcErr } = await supabase.rpc("feed_monster", {
      p_monster_id:   monsterId,
      p_owner_id:     monster.owner_id,
      p_food_key:     foodKey,
      p_satiety_cost: food.satiety_cost,
      p_stat_column:  food.effect_stat,   // 'hp' | 'atk' | 'def' | 'spd' | 'crit' | 'dodge'
      p_stat_value:   food.effect_value,  // misal 5 untuk Berry (+5 HP)
    });

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message ?? "The feeding ritual failed. Please try again." },
        { status: 400 }
      );
    }

    // 6. Kembalikan state terbaru ke client
    const { data: freshMonster } = await supabase
      .from("monsters")
      .select(
        `id, satiety,
         monster_food_bonus!inner(hp_bonus, atk_bonus, def_bonus, spd_bonus, crit_bonus, dodge_bonus)`
      )
      .eq("id", monsterId)
      .single();

    const { data: freshInv } = await supabase
      .from("inventory")
      .select("quantity")
      .eq("owner_id", monster.owner_id)
      .eq("food_key", foodKey)
      .maybeSingle();

    const statLabel = food.effect_stat.toUpperCase();
    const sign = food.effect_value >= 0 ? "+" : "";
    const suffix = ["crit", "dodge"].includes(food.effect_stat) ? "%" : "";

    return NextResponse.json({
      success:            true,
      monster:            freshMonster,
      remaining_quantity: freshInv?.quantity ?? 0,
      feed_message:       `${food.name} offered. ${statLabel} ${sign}${food.effect_value}${suffix} permanently bound!`,
    });
  } catch (err: any) {
    console.error("[feed] Unexpected error:", err);
    return NextResponse.json(
      { error: err.message ?? "An internal tremor disrupted the feeding ritual." },
      { status: 500 }
    );
  }
}
