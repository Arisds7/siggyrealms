import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_ENERGY       = 300;
const REGEN_INTERVAL_M = 3;   // +1 energy setiap 3 menit
const REGEN_PER_TICK   = 1;   // jumlah energy per interval

/**
 * POST /api/cron/energy-regen
 *
 * Dipanggil oleh GitHub Actions setiap 5 menit.
 * Menghitung energy regenerasi berdasarkan waktu yang sudah berlalu
 * sejak energy_last_regen_at untuk setiap monster yang belum full.
 *
 * ── Pendekatan bulk update ───────────────────────────────────────────────────
 * Kami menggunakan satu Supabase RPC yang memanggil raw SQL function
 * `regen_all_monster_energy()` yang sudah didefinisikan di database.
 * Keuntungan:
 *   - Satu round-trip ke database, sekecil apapun jumlah monster
 *   - Kalkulasi dilakukan di sisi database (aman dari clock skew server)
 *   - Tidak ada loop N+1 query di application layer
 *
 * Alternatif yang TIDAK dipakai:
 *   - Loop per monster: O(N) queries — tidak scalable
 *   - .update() dengan JavaScript: butuh read dulu, kalkulasi, lalu write
 *     = tetap N+1 atau harus select all dulu (data besar tidak efisien)
 *
 * ── Trade-off energy_last_regen_at ──────────────────────────────────────────
 * Saat update, energy_last_regen_at diset ke:
 *   energy_last_regen_at + (energy_added * interval)
 * BUKAN ke NOW(). Ini menjaga "sisa menit" yang belum genap 3 menit.
 * Contoh: kalau sudah 7 menit berlalu, dapat +2 energy,
 * dan energy_last_regen_at maju 6 menit (2 * 3), bukan ke waktu sekarang.
 * Dengan begitu 1 menit sisa tetap terhitung di tick berikutnya.
 *
 * Kalau diset ke NOW() (cara simpel), sisa menit itu hilang setiap cycle
 * — dalam jangka panjang monster dapat sedikit lebih sedikit regen dari
 * yang seharusnya.
 */
export async function POST(req: NextRequest) {
  // ── Auth guard ───────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server." },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;

  if (token !== cronSecret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // ── Run bulk regen via Supabase RPC ──────────────────────────────────────
  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("regen_all_monster_attributes", {
    p_max_energy:       MAX_ENERGY,
    p_energy_interval:  REGEN_INTERVAL_M,
    p_energy_per_tick:  REGEN_PER_TICK,
    p_max_satiety:      100,
    p_satiety_interval: 60,
    p_satiety_per_tick: 10,
  });

  if (error) {
    console.error("[energy-regen] RPC error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const result = data && data[0] ? data[0] : { energy_updated: 0, satiety_updated: 0 };
  console.log(
    `[energy-regen] Done. Energy updated: ${result.energy_updated}, Satiety updated: ${result.satiety_updated}`
  );

  return NextResponse.json({
    success:  true,
    energy_updated:  result.energy_updated,
    satiety_updated: result.satiety_updated,
    tick_utc: new Date().toISOString(),
  });
}

// Also support GET so GitHub Actions can use either method
export { POST as GET };
