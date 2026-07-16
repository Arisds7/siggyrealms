"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import LoadingScreen from "@/components/ui/LoadingScreen";
import { useUserStats } from "@/lib/context/UserStatsContext";
import { useBackgroundMusic } from "@/lib/hooks/useBackgroundMusic";

interface ShopItem {
  key: string;
  name: string;
  effectDesc: string;
  satietyCost: number;
  price_sig: number;
}

interface ApiResponse {
  items: ShopItem[];
}

export default function ShopPage() {
  const router = useRouter();
  // ── Global user stats (sig_balance shared across all pages) ───────────────
  const { sigBalance, refresh: refreshStats } = useUserStats();

  // ── Background Music ──────────────────────────────────────────────────────
  const { isMuted, toggleMute } = useBackgroundMusic({
    src: "/audio/shop.mp3",
    volume: 0.25,
    loop: true,
  });

  const [items, setItems] = useState<ShopItem[]>([]);
  const [twitterHandle, setTwitterHandle] = useState<string>("player");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Keep track of quantities selected for purchase per item key
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [buying, setBuying] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, []);

  // ── Fetch Shop Items & User Info ──────────────────────────────────────────
  useEffect(() => {
    const wallet =
      typeof window !== "undefined"
        ? localStorage.getItem("siggy_wallet_address")
        : null;

    if (!wallet) {
      router.replace("/login");
      return;
    }

    async function initShop() {
      try {
        // Fetch food pricing and details
        const shopRes = await fetch("/api/shop/list");
        if (!shopRes.ok) throw new Error("The Alchemy Bazaar failed to reveal its wares. The Realms are trembling.");
        const shopData: ApiResponse = await shopRes.json();
        setItems(shopData.items);

        // Initialize quantities with 1 for all items
        const initialQuantities: Record<string, number> = {};
        shopData.items.forEach((item) => {
          initialQuantities[item.key] = 1;
        });
        setQuantities(initialQuantities);

        // Fetch user data for profile info only (sig_balance comes from global context)
        const userRes = await fetch(
          `/api/monster/list?t=${Date.now()}`,
          { headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" } }
        );
        if (userRes.ok) {
          const userData = await userRes.json();
          if (userData.twitter_handle) {
            setTwitterHandle(userData.twitter_handle);
          }
        }
      } catch (err: any) {
        setError(err.message ?? "A disturbance rippled through the Bazaar. Please try again.");
      } finally {
        setIsLoading(false);
      }
    }

    initShop();
  }, [router]);

  // ── Buy Handler ─────────────────────────────────────────────────────────────
  const handleBuy = async (itemKey: string) => {
    const qty = quantities[itemKey] ?? 1;
    const wallet = localStorage.getItem("siggy_wallet_address");
    if (!wallet) return;

    setBuying((prev) => ({ ...prev, [itemKey]: true }));
    try {
      const res = await fetch("/api/shop/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          foodKey: itemKey,
          quantity: qty,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error ?? "The Vault rejected your offering. Ritual cancelled.");
        return;
      }

      // Trigger global stats refresh so sig_balance updates everywhere
      await refreshStats();
      showToast(`${qty}x ${data.food_name} has been bound to your Vault!`);
      
      // Reset input quantity to 1 after successful purchase
      setQuantities((prev) => ({ ...prev, [itemKey]: 1 }));
    } catch (err) {
      showToast("The Bazaar channel collapsed. Check your connection and try again.");
    } finally {
      setBuying((prev) => ({ ...prev, [itemKey]: false }));
    }
  };

  const handleQtyChange = (itemKey: string, val: number) => {
    if (isNaN(val) || val < 1) val = 1;
    if (val > 99) val = 99;
    setQuantities((prev) => ({ ...prev, [itemKey]: val }));
  };

  if (isLoading) {
    return (
      <LoadingScreen
        tips={[
          "Opening the gateway to the Alchemy Bazaar…",
          "Channelling into the Realm's treasury…",
          "Preparing elixirs and nourishment for your Siggy…",
        ]}
      />
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0b14] p-6">
        <div className="text-center space-y-4">
          <p className="text-red-400 font-mono">{error}</p>
          <button
            onClick={() => router.push("/dashboard")}
            className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors shadow-lg"
          >
            Return to Codex
          </button>
        </div>
      </main>
    );
  }

  const wallet =
    typeof window !== "undefined"
      ? localStorage.getItem("siggy_wallet_address") ?? ""
      : "";

  const textShadowStyle = { textShadow: "0 1px 4px rgba(0,0,0,0.8)" };

  return (
    <main className="relative min-h-screen w-full text-white overflow-x-hidden select-none flex flex-col justify-between">
      {/* ── BACKGROUND (Full-bleed, matching Dashboard) ── */}
      <div className="absolute inset-0 w-full h-full -z-20 overflow-hidden">
        <Image
          src="/branding/dashboard-background.png"
          alt="Ancient Siggy Realm"
          fill
          priority
          className="object-cover object-center pointer-events-none"
        />
        <div className="absolute inset-0 bg-black/40 pointer-events-none" />
      </div>

      {/* Toast Alert overlay */}
      {toastMessage && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full bg-black/85 border border-white/10 backdrop-blur-md text-sm text-violet-300 font-mono animate-fade-in shadow-xl shadow-black/40">
          {toastMessage}
        </div>
      )}

      {/* ── TOP BAR ── */}
      <header className="w-full z-40 px-6 py-4 flex items-center justify-between pointer-events-auto">
        {/* Left: Go back to Codex */}
        <Link
          href="/dashboard"
          className="flex items-center gap-2 cursor-pointer bg-black/30 hover:bg-black/45 px-4 py-2 rounded-full border border-white/5 backdrop-blur-md transition-all shadow-md"
        >
          <span className="text-white/80 text-xs font-mono group-hover:text-violet-400 transition-colors">
            ← Back to Codex
          </span>
        </Link>

        {/* Middle: Brand Title */}
        <h1 className="text-xl font-bold tracking-[0.25em] text-white/95 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] font-sans">
          ALCHEMY BAZAAR
        </h1>

        {/* Right: User Twitter & Current SIG Balance */}
        <div className="flex items-center gap-3">
          {/* Mute toggle button */}
          <button
            onClick={toggleMute}
            className="w-9 h-9 rounded-full bg-black/30 hover:bg-black/45 border border-white/5 backdrop-blur-md flex items-center justify-center text-xs transition-all active:scale-95 shadow-md pointer-events-auto"
            title={isMuted ? "Unmute Ambient Music" : "Mute Ambient Music"}
          >
            {isMuted ? "🔇" : "🔊"}
          </button>

          <div className="flex items-center gap-2 bg-black/30 px-3.5 py-2 rounded-full border border-white/5 backdrop-blur-md shadow-md">
            <span className="text-amber-400 text-sm">✦</span>
            <span className="text-sm font-semibold tracking-wider font-mono text-white/90">
              {sigBalance}
            </span>
            <span className="text-[10px] text-white/40 tracking-wider">SIG</span>
          </div>

          <div className="flex items-center gap-2 bg-black/30 px-3.5 py-2 rounded-full border border-white/5 backdrop-blur-md shadow-md">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white uppercase font-mono shadow-sm">
              {twitterHandle.slice(0, 2)}
            </div>
            <span className="text-white/90 text-xs font-mono">
              @{twitterHandle}
            </span>
          </div>
        </div>
      </header>

      {/* ── MAIN CONTENT AREA: Food Items List Grid ── */}
      <div className="flex-1 w-full max-w-5xl mx-auto px-6 flex flex-col justify-center py-8 z-20">
        <div className="mb-6 text-center">
          <h2 style={textShadowStyle} className="text-2xl font-bold tracking-wide">Provide Nourishment</h2>
          <p style={textShadowStyle} className="text-white/70 text-xs mt-1 font-mono uppercase">
            Exchange SIG to acquire mystical elements that enhance your Siggy's attributes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item) => {
            const isBuying = !!buying[item.key];
            const currentQty = quantities[item.key] ?? 1;
            const totalPrice = item.price_sig * currentQty;

            return (
              <div
                key={item.key}
                className="relative p-5 rounded-2xl bg-black/25 backdrop-blur-[8px] border border-white/5 shadow-xl flex flex-col justify-between gap-4"
              >
                {/* Visual item illustration space/fallback */}
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl relative overflow-hidden shadow-inner">
                    <span className="z-10 drop-shadow">
                      {item.key === "berry" && "🍒"}
                      {item.key === "meat" && "🥩"}
                      {item.key === "shell" && "🐚"}
                      {item.key === "feather" && "🪶"}
                      {item.key === "crystal" && "💎"}
                      {item.key === "mist" && "💨"}
                    </span>
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
                  </div>

                  <div style={textShadowStyle} className="flex-1">
                    <h3 className="text-base font-bold tracking-wide capitalize">{item.name}</h3>
                    <p className="text-white/80 text-xs font-bold text-violet-300">
                      {item.effectDesc}
                    </p>
                    <p className="text-[10px] text-white/50 font-mono mt-0.5">
                      Satiety Cost: −{item.satietyCost} Satiety
                    </p>
                  </div>
                </div>

                {/* Settle Area: Price & Action */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
                  {/* Price info */}
                  <div className="flex flex-col">
                    <span className="text-[9px] text-white/40 uppercase tracking-widest font-mono">Price</span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-lg font-bold text-amber-300 font-mono">
                        {totalPrice}
                      </span>
                      <span className="text-[10px] text-white/40 font-mono">SIG</span>
                    </div>
                  </div>

                  {/* Quantity selector & buy action */}
                  <div className="flex items-center gap-1.5">
                    {/* Quantity selectors */}
                    <div className="flex items-center bg-white/5 border border-white/10 rounded-lg overflow-hidden">
                      <button
                        onClick={() => handleQtyChange(item.key, currentQty - 1)}
                        className="px-2.5 py-1 text-xs text-white/60 hover:text-white transition-colors"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={currentQty}
                        onChange={(e) => handleQtyChange(item.key, parseInt(e.target.value))}
                        className="w-10 bg-transparent text-center text-xs font-mono font-bold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <button
                        onClick={() => handleQtyChange(item.key, currentQty + 1)}
                        className="px-2.5 py-1 text-xs text-white/60 hover:text-white transition-colors"
                      >
                        +
                      </button>
                    </div>

                    {/* Buy button */}
                    <button
                      onClick={() => handleBuy(item.key)}
                      disabled={isBuying}
                      className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-xs font-bold transition-all active:scale-95 shadow-md disabled:opacity-50"
                    >
                      {isBuying ? "Buying…" : "Buy"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── BOTTOM HUD (Matching style of Dashboard) ── */}
      <footer className="w-full z-30 px-6 pb-6 pt-2 pointer-events-auto">
        <div className="max-w-4xl mx-auto flex items-center justify-between bg-black/35 backdrop-blur-md border border-white/5 rounded-full px-6 py-3 shadow-lg shadow-black/25">
          <div className="text-[10px] text-white/40 font-mono tracking-wider">
            Connected Wallet: {wallet.slice(0, 6)}…{wallet.slice(-4)}
          </div>
          <div className="hidden md:block text-[11px] text-white/35 font-mono tracking-widest uppercase">
            Ritual Network Testnet
          </div>
          <div className="text-[10px] text-white/40 font-mono tracking-wider">
            Alchemy Bazaar Vault
          </div>
        </div>
      </footer>
    </main>
  );
}
