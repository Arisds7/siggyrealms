"use client";

import { UserStatsProvider } from "@/lib/context/UserStatsContext";

/**
 * Layout untuk semua halaman game (dashboard, shop, quest, arena, mint).
 * UserStatsProvider di sini supaya sig_balance + arena_tickets
 * di-share ke semua halaman melalui satu context — tidak ada lagi
 * state lokal terpisah per halaman.
 */
export default function GameLayout({ children }: { children: React.ReactNode }) {
  return <UserStatsProvider>{children}</UserStatsProvider>;
}
