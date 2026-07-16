"use client";

/**
 * UserStatsContext
 *
 * Satu-satunya sumber kebenaran untuk sig_balance dan arena_tickets
 * di seluruh halaman game. Semua halaman (shop, quest, arena, dashboard)
 * membaca dari sini — tidak ada local state balance yang terpisah.
 *
 * Cara kerja:
 * 1. Mount di app/(game)/layout.tsx — jadi aktif selama user di halaman game.
 * 2. Fetch dari /api/user/stats (ringan, hanya 2 kolom dari tabel users).
 * 3. Expose refresh() yang dipanggil setelah setiap mutasi (battle, klaim, beli).
 * 4. Refresh juga dilakukan lazy — halaman /arena memanggil refresh() saat mount
 *    supaya daily ticket reset selalu ter-capture meskipun user tidak reload app.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserStats {
  sigBalance:    number;
  arenaTickets:  number;
  arenaTicketsMax: number;
  isLoaded:      boolean; // false selama fetch pertama belum selesai
}

interface UserStatsContextValue extends UserStats {
  /** Silent re-fetch dari DB — panggil setelah setiap mutasi */
  refresh: () => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const UserStatsContext = createContext<UserStatsContextValue>({
  sigBalance:      0,
  arenaTickets:    3,
  arenaTicketsMax: 3,
  isLoaded:        false,
  refresh:         async () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function UserStatsProvider({ children }: { children: React.ReactNode }) {
  const [stats, setStats] = useState<UserStats>({
    sigBalance:      0,
    arenaTickets:    3,
    arenaTicketsMax: 3,
    isLoaded:        false,
  });

  // Wallet disimpan di ref agar refresh() tidak perlu wallet sebagai param
  // dan tidak membuat stale closure saat dipanggil dari setTimeout
  const walletRef = useRef<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/user/stats?t=${Date.now()}`,
        {
          headers: {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
          },
        }
      );
      if (!res.ok) return; // silent — jangan crash UI karena background refresh gagal
      const data = await res.json();
      setStats({
        sigBalance:      data.sig_balance      ?? 0,
        arenaTickets:    data.arena_tickets     ?? 3,
        arenaTicketsMax: data.arena_tickets_max ?? 3,
        isLoaded:        true,
      });
    } catch {
      // Silently ignore network errors during background refresh
    }
  }, []);

  // Initial load — jalankan satu kali setelah wallet tersedia
  useEffect(() => {
    const wallet =
      typeof window !== "undefined"
        ? localStorage.getItem("siggy_wallet_address")
        : null;

    if (!wallet) return; // halaman login/register tidak pakai provider ini
    walletRef.current = wallet;

    // Set isLoaded=false selama fetch pertama berlangsung
    setStats((prev) => ({ ...prev, isLoaded: false }));
    fetchStats();
  }, [fetchStats]);

  const value: UserStatsContextValue = {
    ...stats,
    refresh: fetchStats,
  };

  return (
    <UserStatsContext.Provider value={value}>
      {children}
    </UserStatsContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useUserStats(): UserStatsContextValue {
  return useContext(UserStatsContext);
}
