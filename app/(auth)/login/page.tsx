"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { getWalletClient } from "@/lib/contracts/viemClient";
import { useBackgroundMusic } from "@/lib/hooks/useBackgroundMusic";
import { useEIP6963, EIP6963ProviderDetail } from "@/lib/hooks/useEIP6963";

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthStep =
  | "idle"           // Nothing connected yet
  | "wallet_bound"   // Wallet connected, nonce fetched — waiting for signature
  | "verified"       // Signature verified, session cookie set — ready to submit
  | "submitting";    // Registering & redirecting

// ─── Component ────────────────────────────────────────────────────────────────

export default function LoginPage() {
  const router = useRouter();

  // Form state
  const [twitterHandle, setTwitterHandle] = useState("");
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<any>(null);
  const [existingUserHandle, setExistingUserHandle] = useState<string | null>(null);

  // Auth flow state
  const [authStep, setAuthStep] = useState<AuthStep>("idle");
  const [nonce, setNonce] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [showWalletSelector, setShowWalletSelector] = useState(false);

  const { providers } = useEIP6963();

  // Background music
  const { isMuted, toggleMute } = useBackgroundMusic({
    src: "/audio/login-theme.mp3",
    volume: 0.3,
    loop: true,
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  async function fetchNonce(address: string): Promise<string> {
    const res = await fetch(
      `/api/auth/nonce?walletAddress=${encodeURIComponent(address)}`
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to request authentication nonce.");
    }
    const data = await res.json();
    return data.nonce as string;
  }

  async function checkExistingUser(address: string) {
    try {
      const res = await fetch(`/api/auth/check?wallet=${encodeURIComponent(address)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.exists && data.twitter_handle) {
          setExistingUserHandle(data.twitter_handle);
          setTwitterHandle(data.twitter_handle);
        }
      }
    } catch {
      // Silently ignore — user can still proceed
    }
  }

  // ── Step 1: Connect Wallet ────────────────────────────────────────────────

  async function handleConnectWallet() {
    setError(null);

    // Multiple providers → show selector
    if (providers.length > 1) {
      setShowWalletSelector(true);
      return;
    }

    const provider =
      providers.length === 1 ? providers[0].provider : (window as any).ethereum;
    if (!provider) {
      setError("No wallet conduit detected in this realm.");
      return;
    }

    await connectWithProvider(provider);
  }

  async function handleSelectWallet(providerDetail: EIP6963ProviderDetail) {
    setError(null);
    setShowWalletSelector(false);
    await connectWithProvider(providerDetail.provider);
  }

  async function connectWithProvider(provider: any) {
    try {
      const client = getWalletClient(provider);
      const [address] = await client.requestAddresses();

      setWalletAddress(address);
      setSelectedProvider(provider);

      // Fetch SIWE nonce for this wallet
      const fetchedNonce = await fetchNonce(address);
      setNonce(fetchedNonce);

      // Pre-fill twitter handle if user was already registered
      await checkExistingUser(address);

      setAuthStep("wallet_bound");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to bind wallet. Ensure your extension is active."
      );
    }
  }

  // ── Step 2: Sign Message (SIWE) ───────────────────────────────────────────

  async function handleSignMessage() {
    if (!walletAddress || !nonce || !selectedProvider) {
      setError("Wallet or nonce missing. Please reconnect your wallet.");
      return;
    }

    setSigning(true);
    setError(null);

    try {
      const client = getWalletClient(selectedProvider);

      // IMPORTANT: This message MUST match exactly what /api/auth/verify expects.
      const message = `Sign this message to authenticate with Siggy Realms.\n\nNonce: ${nonce}`;

      const signature = await client.signMessage({
        account: walletAddress as `0x${string}`,
        message,
      });

      // Send signature to backend for verification
      const verifyRes = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress, nonce, signature }),
      });

      if (!verifyRes.ok) {
        const body = await verifyRes.json().catch(() => ({}));
        throw new Error(body.error ?? "Signature verification failed.");
      }

      // Session cookie is now set by the server.
      // Also store in localStorage for V1 dashboard backward-compat (Tahap 1 only).
      localStorage.setItem("siggy_wallet_address", walletAddress);

      setAuthStep("verified");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to sign message. Please try again."
      );
    } finally {
      setSigning(false);
    }
  }

  // ── Step 3: Register & Redirect ───────────────────────────────────────────

  async function handleSubmit() {
    if (!twitterHandle.trim() || !walletAddress) {
      setError("Provide your X handle and bind your wallet to begin.");
      return;
    }
    if (authStep !== "verified") {
      setError("Please sign the authentication message first.");
      return;
    }

    setAuthStep("submitting");
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

      // Check if user already has a Siggy to decide where to redirect
      const listRes = await fetch(
        `/api/monster/list?wallet=${encodeURIComponent(walletAddress)}`
      );
      if (listRes.ok) {
        const listData = await listRes.json();
        const hasMonster =
          Array.isArray(listData.monsters) && listData.monsters.length > 0;
        router.push(hasMonster ? "/dashboard" : "/mint");
      } else {
        router.push("/mint");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "A disturbance disrupted the ritual."
      );
      setAuthStep("verified"); // Allow retry
    }
  }

  // ── Derived UI State ──────────────────────────────────────────────────────

  const isSubmitting = authStep === "submitting";
  const isVerified   = authStep === "verified" || isSubmitting;

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

      {/* ── Hero Illustration ── */}
      <div className="absolute inset-0 z-0">
        <Image
          src="/branding/login_page.png"
          alt="Siggy Realms — Enter the Realm"
          fill
          priority
          className="object-cover object-center opacity-60"
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(13,11,20,0.98) 0%, rgba(13,11,20,0.65) 55%, rgba(13,11,20,0.2) 100%)",
          }}
        />
      </div>

      {/* ── Form Card ── */}
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

        {/* X / Twitter Handle */}
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
              disabled={!!existingUserHandle || isSubmitting}
              className={[
                "w-full rounded-xl border bg-white/5 pl-8 pr-4 py-3 text-white placeholder:text-white/25 focus:outline-none transition-all",
                existingUserHandle || isSubmitting
                  ? "border-white/10 cursor-not-allowed opacity-60"
                  : "border-white/10 focus:border-violet-500/60",
              ].join(" ")}
            />
          </div>
          {existingUserHandle && (
            <p className="text-emerald-400 text-xs mt-1.5">
              ✓ This conduit is already bound to @{existingUserHandle}
            </p>
          )}
        </div>

        {/* ── STEP 1: Connect Wallet ── */}
        <button
          id="bind-wallet-button"
          onClick={handleConnectWallet}
          disabled={authStep !== "idle" || isSubmitting}
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

        {/* ── STEP 2: Sign Message (SIWE) ── shown after wallet is bound */}
        {authStep === "wallet_bound" && (
          <button
            id="sign-message-button"
            onClick={handleSignMessage}
            disabled={signing}
            className="w-full rounded-xl py-3 font-semibold text-sm bg-violet-500/20 border border-violet-500/40 text-violet-300 hover:bg-violet-500/30 hover:border-violet-500/60 transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {signing ? "The crystal is resonating…" : "✍️ Sign to Authenticate"}
          </button>
        )}

        {/* Signature verified indicator */}
        {isVerified && (
          <div className="w-full rounded-xl py-2.5 px-4 bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-sm text-center">
            ✓ Identity verified by the Realms
          </div>
        )}

        {/* ── Wallet Selector Modal ── */}
        {showWalletSelector && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="bg-[#1a1625] border border-white/10 rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
              <h3 className="text-white font-semibold text-lg mb-4 text-center">
                Select Your Wallet
              </h3>
              <div className="space-y-2">
                {providers.map((provider) => (
                  <button
                    key={provider.info.uuid}
                    onClick={() => handleSelectWallet(provider)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all active:scale-[0.98]"
                  >
                    {provider.info.icon && (
                      <img
                        src={provider.info.icon}
                        alt={provider.info.name}
                        className="w-8 h-8 rounded"
                      />
                    )}
                    <span className="text-white font-medium text-sm">
                      {provider.info.name}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowWalletSelector(false)}
                className="w-full mt-4 py-2 text-white/50 text-sm hover:text-white/80 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: Begin the Ritual (only active after verification) ── */}
        <button
          id="begin-ritual-button"
          onClick={handleSubmit}
          disabled={isSubmitting || !walletAddress || !twitterHandle.trim() || !isVerified}
          className="w-full rounded-xl py-3.5 font-bold text-base bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-900/40 transition-all duration-200 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:from-violet-600 disabled:hover:to-purple-600"
        >
          {isSubmitting ? "Consulting the Realms…" : "Begin the Ritual"}
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
