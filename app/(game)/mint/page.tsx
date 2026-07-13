"use client";

import { useState, useEffect, useCallback } from "react";
import {
  publicClient,
  getWalletClient,
  GENESIS_EGG_ADDRESS,
  ritualTestnet,
} from "@/lib/contracts/viemClient";
import GenesisEggABI from "@/lib/contracts/abi/GenesisEgg.json";

import { useRouter } from "next/navigation";
import Image from "next/image";

// ─── Types ─────────────────────────────────────────────────────────────────────

type MintStatus =
  | "idle"
  | "checking"
  | "already_minted"
  | "waiting_wallet"
  | "pending"
  | "success"
  | "error";

// ─── Component ─────────────────────────────────────────────────────────────────

export default function MintPage() {
  const router = useRouter();
  const [status, setStatus] = useState<MintStatus>("idle");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [tokenId, setTokenId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<`0x${string}` | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [totalSupply, setTotalSupply] = useState<string | null>(null);

  // ── Connect wallet & read on-chain state ──────────────────────────────────
  const connectAndCheck = useCallback(async () => {
    setStatus("checking");
    setErrorMessage(null);

    try {
      const wc = getWalletClient();
      const [address] = await wc.requestAddresses();
      setWalletAddress(address);

      // Check registration & monster ownership status in database
      const checkRes = await fetch(`/api/auth/check?wallet=${address}`);
      const checkData = await checkRes.json();

      if (!checkData.userId) {
        setErrorMessage("You must bind your X/Twitter account to the Realms first.");
        setTimeout(() => router.push("/login"), 2000);
        setStatus("error");
        return;
      }

      if (checkData.hasMonster) {
        router.push("/dashboard");
        return;
      }

      // Read hasMinted and totalSupply in parallel
      const [minted, supply] = await Promise.all([
        publicClient.readContract({
          address: GENESIS_EGG_ADDRESS,
          abi: GenesisEggABI,
          functionName: "hasMinted",
          args: [address],
        }),
        publicClient.readContract({
          address: GENESIS_EGG_ADDRESS,
          abi: GenesisEggABI,
          functionName: "totalSupply",
        }),
      ]);

      setTotalSupply(supply?.toString() ?? "0");

      if (minted) {
        setStatus("already_minted");
        return;
      }

      setStatus("idle");
    } catch (err: any) {
      setErrorMessage(err?.message ?? "Failed to bind your wallet to the Realms.");
      setStatus("error");
    }
  }, [router]);

  // Auto-fetch total supply on mount (tanpa connect wallet)
  useEffect(() => {
    publicClient
      .readContract({
        address: GENESIS_EGG_ADDRESS,
        abi: GenesisEggABI,
        functionName: "totalSupply",
      })
      .then((s) => setTotalSupply(s?.toString() ?? "0"))
      .catch(() => {});
  }, []);

  // Auto-redirect if wallet already has monster
  useEffect(() => {
    const savedWallet = localStorage.getItem("siggy_wallet_address");
    if (savedWallet) {
      setWalletAddress(savedWallet as `0x${string}`);
      fetch(`/api/auth/check?wallet=${savedWallet}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.hasMonster) {
            router.push("/dashboard");
          }
        })
        .catch(() => {});
    }
  }, [router]);

  // ── Mint ──────────────────────────────────────────────────────────────────
  const handleMint = async () => {
    setErrorMessage(null);

    // Step 1: connect wallet if not connected yet
    if (!walletAddress) {
      await connectAndCheck();
      return; // user will click again after seeing their address
    }

    try {
      const wc = getWalletClient();

      // Step 1.2: Check if user is registered in the database and has no monster
      setStatus("checking");
      const checkRes = await fetch(`/api/auth/check?wallet=${walletAddress}`);
      const checkData = await checkRes.json();
      if (!checkData.userId) {
        setErrorMessage("Your X/Twitter account must be linked before awakening a Crystal.");
        setTimeout(() => router.push("/login"), 2000);
        setStatus("error");
        return;
      }
      if (checkData.hasMonster) {
        router.push("/dashboard");
        return;
      }

      // Step 1.5: Verify and switch chain if necessary
      const currentChainId = await wc.getChainId();
      if (currentChainId !== 1979) {
        setStatus("checking");
        try {
          await wc.switchChain({ id: 1979 });
        } catch (switchError: any) {
          // 4902 indicates that the chain has not been added to the wallet
          if (switchError.code === 4902 || (switchError.message && switchError.message.includes("Unrecognized chain ID"))) {
            try {
              await wc.addChain({ chain: ritualTestnet });
            } catch (addError: any) {
               throw new Error("Failed to add Ritual Testnet to your wallet. Please add it manually.");
            }
          } else {
             throw new Error("Please switch your wallet network to Ritual Testnet (Chain ID 1979) to proceed.");
          }
        }
      }

      // Step 2: request wallet approval popup
      setStatus("waiting_wallet");
      const hash = await wc.writeContract({
        address: GENESIS_EGG_ADDRESS,
        abi: GenesisEggABI,
        functionName: "mint",
        account: walletAddress,
        chain: ritualTestnet,
      });

      setTxHash(hash);

      // Step 3: wait for tx to be included in a block
      setStatus("pending");
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: 1,
      });

      // Step 4: parse tokenId from Minted event logs
      let mintedId: string | null = null;
      for (const log of receipt.logs) {
        // Minted(address indexed to, uint256 indexed tokenId)
        // topics[0] = event sig, topics[1] = to, topics[2] = tokenId
        if (log.topics.length === 3) {
          const toTopic = log.topics[1];
          const addr = `0x${toTopic?.slice(-40)}`.toLowerCase();
          if (addr === walletAddress.toLowerCase()) {
            mintedId = BigInt(log.topics[2] ?? "0x0").toString();
            break;
          }
        }
      }

      setTokenId(mintedId);

      // Refresh total supply
      publicClient
        .readContract({
          address: GENESIS_EGG_ADDRESS,
          abi: GenesisEggABI,
          functionName: "totalSupply",
        })
        .then((s) => setTotalSupply(s?.toString() ?? "0"))
        .catch(() => {});

      // Step 5: Call backend API to claim monster in database
      const res = await fetch("/api/monster/mint", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          walletAddress,
          txHash: hash,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to awaken the Siggy in the Codex.");
      }

      setStatus("success");

      // Step 6: Redirect to dashboard after a short delay
      setTimeout(() => {
        router.push("/dashboard");
      }, 2000);
    } catch (err: any) {
      const msg: string = err?.message ?? "The on-chain ritual has failed.";
      // User rejected
      if (msg.includes("User rejected") || msg.includes("user rejected")) {
        setErrorMessage("You rejected the summoning. The ritual was not completed.");
      } else if (msg.includes("already minted")) {
        setStatus("already_minted");
        return;
      } else {
        setErrorMessage(msg.slice(0, 200));
      }
      setStatus("error");
    }
  };

  // ─── UI helpers ────────────────────────────────────────────────────────────

  const explorerTx = (hash: string) =>
    `https://explorer.ritualfoundation.org/tx/${hash}`;

  const shortAddr = (addr: string) =>
    `${addr.slice(0, 6)}...${addr.slice(-4)}`;

  const shortHash = (hash: string) =>
    `${hash.slice(0, 10)}...${hash.slice(-8)}`;

  // ─── Button label & disabled state ────────────────────────────────────────

  const buttonConfig: Record<MintStatus, { label: string; disabled: boolean }> = {
    idle: {
      label: walletAddress ? "🔮 Awaken Crystal" : "🔗 Bind Your Wallet",
      disabled: false,
    },
    checking: { label: "Consulting the Realms...", disabled: true },
    already_minted: { label: "✅ Already Awakened", disabled: true },
    waiting_wallet: { label: "⏳ The crystal is resonating...", disabled: true },
    pending: { label: "⛏️ Forging on-chain...", disabled: true },
    success: { label: "✅ Ritual Complete!", disabled: true },
    error: {
      label: walletAddress ? "🔮 Attempt Ritual" : "🔗 Bind Your Wallet",
      disabled: false,
    },
  };

  const btn = buttonConfig[status];

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <main className="min-h-screen bg-[#0a0a0f] text-white flex flex-col items-center justify-center p-6">
      {/* Background glow */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="relative w-40 h-40 mx-auto mb-4 drop-shadow-[0_0_40px_rgba(167,139,250,0.8)]">
            <Image
              src="/crystal.png"
              alt="Genesis Crystal"
              fill
              className="object-contain animate-[pulse_4s_ease-in-out_infinite] hover:scale-105 transition-transform duration-500"
            />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-300 via-purple-200 to-pink-300 bg-clip-text text-transparent">
            Genesis Crystal
          </h1>
          <p className="mt-2 text-white/50 text-sm">
            Awaken a dormant entity to begin your journey in Siggy Realms
          </p>
          {totalSupply !== null && (
            <p className="mt-1 text-violet-400/70 text-xs font-mono">
              {totalSupply} Genesis Crystal{Number(totalSupply) !== 1 ? "s" : ""} Awakened
            </p>
          )}
        </div>

        {/* Card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm shadow-xl">

          {/* Wallet address */}
          {walletAddress && (
            <div className="mb-4 flex items-center gap-2 bg-white/5 rounded-xl px-3 py-2 border border-white/10">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
              <span className="text-white/60 text-xs font-mono">
                {shortAddr(walletAddress)}
              </span>
            </div>
          )}

          {/* Status message area */}
          <div className="min-h-[64px] mb-4 flex flex-col items-center justify-center text-center">
            {status === "idle" && !walletAddress && (
              <p className="text-white/40 text-sm">
                Bind your wallet to begin the ritual
              </p>
            )}
            {status === "idle" && walletAddress && (
              <p className="text-white/60 text-sm">
                Click the button to awaken your Genesis Crystal!
              </p>
            )}
            {status === "checking" && (
              <p className="text-white/60 text-sm animate-pulse">
                🔍 Consulting the Realms…
              </p>
            )}
            {status === "waiting_wallet" && (
              <p className="text-amber-300 text-sm animate-pulse">
                👛 Open your wallet and authorize the ritual…
              </p>
            )}
            {status === "pending" && txHash && (
              <div className="space-y-1">
                <p className="text-blue-300 text-sm animate-pulse">
                  ⛏️ Stabilizing consciousness on Ritual Testnet…
                </p>
                <a
                  href={explorerTx(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 text-xs font-mono hover:text-violet-300 transition-colors underline underline-offset-2"
                >
                  {shortHash(txHash)} ↗
                </a>
              </div>
            )}
            {status === "already_minted" && (
              <p className="text-amber-300 text-sm">
                🔮 This wallet has already awakened a crystal — 1 Siggy per address!
              </p>
            )}
            {status === "success" && txHash && (
              <div className="space-y-2">
                <p className="text-emerald-400 font-semibold text-base">
                  🎉 Success! Genesis Crystal #{tokenId ?? "?"} has emerged!
                </p>
                <a
                  href={explorerTx(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-violet-400 text-xs font-mono hover:text-violet-300 transition-colors underline underline-offset-2"
                >
                  Tx: {shortHash(txHash)} ↗
                </a>
              </div>
            )}
            {status === "error" && errorMessage && (
              <p className="text-red-400 text-xs leading-relaxed">{errorMessage}</p>
            )}
          </div>

          {/* CTA Button */}
          <button
            id="hatch-egg-button"
            onClick={handleMint}
            disabled={btn.disabled}
            className={[
              "w-full py-4 rounded-xl font-bold text-base transition-all duration-200",
              "focus:outline-none focus:ring-2 focus:ring-violet-500 focus:ring-offset-2 focus:ring-offset-[#0a0a0f]",
              btn.disabled
                ? "bg-white/10 text-white/30 cursor-not-allowed"
                : "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-lg shadow-violet-900/40 hover:shadow-violet-700/40 active:scale-[0.98]",
            ].join(" ")}
          >
            {btn.label}
          </button>

          {/* Progress steps */}
          {(status === "waiting_wallet" || status === "pending" || status === "success") && (
            <div className="mt-4 flex items-center justify-center gap-1.5">
              {[
                { label: "Approve", done: ["pending", "success"].includes(status) },
                { label: "Broadcast", done: status === "success" },
                { label: "Confirmed", done: status === "success" },
              ].map((step, i, arr) => (
                <div key={step.label} className="flex items-center gap-1.5">
                  <div className="flex flex-col items-center gap-0.5">
                    <div
                      className={[
                        "w-5 h-5 rounded-full border-2 flex items-center justify-center text-[10px] font-bold transition-colors",
                        step.done
                          ? "border-emerald-500 bg-emerald-500 text-white"
                          : status !== "success" && i === (status === "waiting_wallet" ? 0 : 1)
                          ? "border-violet-400 bg-violet-400/20 text-violet-300 animate-pulse"
                          : "border-white/20 bg-transparent text-white/30",
                      ].join(" ")}
                    >
                      {step.done ? "✓" : i + 1}
                    </div>
                    <span className="text-[9px] text-white/40">{step.label}</span>
                  </div>
                  {i < arr.length - 1 && (
                    <div className={`w-6 h-px mb-3 ${step.done ? "bg-emerald-500/50" : "bg-white/10"}`} />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="mt-6 text-center space-y-1">
          <p className="text-white/20 text-xs">
            Contract:{" "}
            <a
              href={`https://explorer.ritualfoundation.org/address/${GENESIS_EGG_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:text-white/40 transition-colors"
            >
              {GENESIS_EGG_ADDRESS
                ? `${GENESIS_EGG_ADDRESS.slice(0, 10)}…${GENESIS_EGG_ADDRESS.slice(-8)}`
                : "—"}
            </a>
          </p>
          <p className="text-white/20 text-xs">Ritual Testnet · Chain ID 1979</p>
        </div>
      </div>
    </main>
  );
}
