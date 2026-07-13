"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getWalletClient } from "@/lib/contracts/viemClient";
import { useBackgroundMusic } from "@/lib/hooks/useBackgroundMusic";

export default function LoginPage() {
  const router = useRouter();
  const [twitterHandle, setTwitterHandle] = useState("");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Initialize background music
  const { isMuted, toggleMute } = useBackgroundMusic({
    src: "/audio/login-theme.mp3",
    volume: 0.3,
    loop: true,
  });

  async function handleConnectWallet() {
    setError(null);
    try {
      const client = getWalletClient();
      const [address] = await client.requestAddresses();
      setWalletAddress(address);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to bind wallet. Ensure your extension is active."
      );
    }
  }

  async function handleSubmit() {
    if (!twitterHandle.trim() || !walletAddress) {
      setError("Provide your X handle and bind your wallet to begin.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          twitterHandle: twitterHandle.trim().replace(/^@/, ""),
          walletAddress,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Ritual failed. Could not register.");
      }

      // TODO SECURITY: Storing wallet address in localStorage is intentionally
      // simplified for testnet MVP. Upgrade to signature-based auth (SIWE-style)
      // before mainnet — a signed challenge from the server should verify wallet
      // ownership, not just the address string.
      localStorage.setItem("siggy_wallet_address", walletAddress);

      // Check if user already has a monster to decide where to redirect
      const listRes = await fetch(
        `/api/monster/list?wallet=${encodeURIComponent(walletAddress)}`
      );
      if (listRes.ok) {
        const listData = await listRes.json();
        const hasMonster =
          Array.isArray(listData.monsters) && listData.monsters.length > 0;
        router.push(hasMonster ? "/dashboard" : "/mint");
      } else {
        // Default to mint if list check fails
        router.push("/mint");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0d0b14]">
      {/* ── Audio Mute Controller ── */}
      <button
        onClick={toggleMute}
        className="fixed top-4 right-4 z-50 w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 border border-white/10 text-white backdrop-blur-md transition-all active:scale-95 shadow-md flex items-center justify-center text-sm"
        title={isMuted ? "Unmute Ritual Chant" : "Mute Ritual Chant"}
      >
        {isMuted ? "🔇" : "🔊"}
      </button>

      {/* ── Hero illustration ─────────────────────────────────────────────── */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/branding/login_page.png"
          alt="Siggy Realms — Enter the Realm"
          fill
          priority
          className="object-cover object-center opacity-60"
        />
        {/* Gradient overlay so the form is readable */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(13,11,20,0.98) 0%, rgba(13,11,20,0.65) 55%, rgba(13,11,20,0.2) 100%)",
          }}
        />
      </div>

      {/* ── Form card ─────────────────────────────────────────────────────── */}
      <div className="relative z-10 w-full max-w-sm px-6 pb-10 flex flex-col items-center gap-5">
        {/* Title */}
        <div className="text-center space-y-1 mb-2">
          <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-r from-violet-300 via-purple-200 to-pink-300 bg-clip-text text-transparent drop-shadow">
            Siggy Realms
          </h1>
          <p className="text-white/50 text-sm">
            Bind your identity to enter the ancient realms
          </p>
        </div>

        {/* X / Twitter handle */}
        <div className="w-full">
          <label className="block text-white/60 text-xs mb-1.5 uppercase tracking-wider">
            X / Twitter Handle
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 select-none">
              @
            </span>
            <input
              id="twitter-handle-input"
              type="text"
              placeholder="username"
              value={twitterHandle}
              onChange={(e) => setTwitterHandle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              className="w-full rounded-xl border border-white/10 bg-white/5 pl-8 pr-4 py-3 text-white placeholder:text-white/25 focus:outline-none focus:border-violet-500/60 focus:bg-white/8 transition-all"
            />
          </div>
        </div>

        {/* Connect Wallet button */}
        <button
          id="bind-wallet-button"
          onClick={handleConnectWallet}
          className={[
            "w-full rounded-xl py-3 font-semibold text-sm transition-all duration-200",
            walletAddress
              ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 cursor-default"
              : "bg-white/10 border border-white/10 text-white hover:bg-white/15 hover:border-white/20 active:scale-[0.98]",
          ].join(" ")}
        >
          {walletAddress ? (
            <span className="flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Bound: {walletAddress.slice(0, 6)}…{walletAddress.slice(-4)}
            </span>
          ) : (
            "🔗 Bind Your Wallet"
          )}
        </button>

        {/* Submit button */}
        <button
          id="begin-ritual-button"
          onClick={handleSubmit}
          disabled={loading || !walletAddress || !twitterHandle.trim()}
          className="w-full rounded-xl py-3.5 font-bold text-base bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-900/40 transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-violet-600 disabled:hover:to-purple-600"
        >
          {loading ? "Consulting the Realms…" : "Begin the Ritual"}
        </button>

        {/* Error */}
        {error && (
          <p className="text-red-400 text-xs text-center leading-relaxed">
            {error}
          </p>
        )}

        {/* Footer */}
        <p className="text-white/20 text-xs text-center pt-2">
          Ritual Testnet · Built by Universenaga
        </p>
      </div>
    </main>
  );
}
