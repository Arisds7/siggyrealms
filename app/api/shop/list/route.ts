import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { FOODS, type FoodKey } from "@/lib/constants/foodEffects";

/**
 * GET /api/shop/list
 *
 * Returns all 6 food items with name, effect description, satiety cost,
 * and price_sig pulled from the database `foods` table.
 * The frontend merges DB price with local constant data so we never
 * hard-code prices — they can be changed in the DB without a deploy.
 */
export async function GET() {
  const supabase = createServiceClient();

  const { data: dbFoods, error } = await supabase
    .from("foods")
    .select("key, price_sig")
    .order("price_sig", { ascending: true });

  if (error || !dbFoods) {
    return NextResponse.json({ error: "Gagal memuat daftar persediaan Realm." }, { status: 500 });
  }

  // Merge DB prices with local effect/name metadata
  const priceMap: Record<string, number> = {};
  for (const row of dbFoods) {
    priceMap[row.key] = row.price_sig;
  }

  const items = Object.values(FOODS).map((food) => {
    // Build a human-readable effect description
    const effectEntries = Object.entries(food.effect);
    const effectDesc = effectEntries
      .map(([stat, val]) => {
        const label = stat.toUpperCase();
        const sign = (val as number) >= 0 ? "+" : "";
        const suffix = stat === "crit" || stat === "dodge" ? "%" : "";
        return `${sign}${val}${suffix} ${label}`;
      })
      .join(", ");

    return {
      key:         food.key,
      name:        food.name,
      effectDesc,
      satietyCost: food.satietyCost,
      price_sig:   priceMap[food.key] ?? 0,
    };
  });

  return NextResponse.json({ items });
}
