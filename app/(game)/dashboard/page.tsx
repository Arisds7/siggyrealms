"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import LoadingScreen from "@/components/ui/LoadingScreen";
import { expProgressInLevel, expToLevel } from "@/lib/game-logic/expCalculator";
import {
  EVOLUTION_STAGES,
  canEvolveToNextStage,
  type EvolutionStage,
} from "@/lib/constants/evolutionThresholds";
import { FOODS, type FoodKey } from "@/lib/constants/foodEffects";
import { useBackgroundMusic } from "@/lib/hooks/useBackgroundMusic";
import { useUserStats } from "@/lib/context/UserStatsContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonsterStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  crit: number;
  dodge: number;
}

interface FoodBonus {
  hp_bonus: number;
  atk_bonus: number;
  def_bonus: number;
  spd_bonus: number;
  crit_bonus: number;
  dodge_bonus: number;
}

interface Species {
  key: string;
  name: string;
  element: "fire" | "water" | "nature" | "lightning" | "dark";
  role: string;
}

interface Monster {
  id: string;
  nickname: string | null;
  token_id: number | null;
  level: number;
  exp: number;
  evolution_stage: string;
  energy: number;
  satiety: number;
  species_key: string;
  species: Species;
  monster_stats: MonsterStats;
  monster_food_bonus: FoodBonus;
}

interface InventoryItem {
  food_key: string;
  quantity: number;
}

interface ApiResponse {
  sig_balance: number;
  twitter_handle: string;
  monsters: Monster[];
  inventory: InventoryItem[];
}

// ─── Constants & Styles ───────────────────────────────────────────────────────

const ELEMENT_COLORS: Record<string, { text: string; glow: string; btn: string; border: string }> = {
  fire:      { text: "text-[#e4572e]", glow: "from-[#e4572e]/40", btn: "bg-[#e4572e] hover:bg-[#e4572e]/85", border: "border-[#e4572e]/40" },
  water:     { text: "text-[#2e86e4]", glow: "from-[#2e86e4]/40", btn: "bg-[#2e86e4] hover:bg-[#2e86e4]/85", border: "border-[#2e86e4]/40" },
  nature:    { text: "text-[#3fae5c]", glow: "from-[#3fae5c]/40", btn: "bg-[#3fae5c] hover:bg-[#3fae5c]/85", border: "border-[#3fae5c]/40" },
  lightning: { text: "text-[#f2c94c]", glow: "from-[#f2c94c]/40", btn: "bg-[#f2c94c] text-black hover:bg-[#f2c94c]/85", border: "border-[#f2c94c]/40" },
  dark:      { text: "text-[#a87be0]", glow: "from-[#5b2e8f]/60", btn: "bg-[#5b2e8f] hover:bg-[#5b2e8f]/85", border: "border-[#5b2e8f]/40" },
};

const MENU_ITEMS = [
  { label: "Shop", scope: "active" },
  { label: "Daily Quest", scope: "active" },
  { label: "Arena", scope: "active" },
  { label: "PvP", scope: "excluded_v1" }, // NOTE: excluded dari scope V1
  { label: "Leaderboard", scope: "excluded_v1" }, // NOTE: excluded dari scope V1
  { label: "Inventory", scope: "next_week" },
  { label: "Collection", scope: "next_week" },
];

export default function DashboardPage() {
  const router = useRouter();
  const { sigBalance, refresh: refreshStats } = useUserStats();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [progress, setProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Active monster switching state
  const [activeIndex, setActiveIndex] = useState(0);
  const [tapping, setTapping] = useState(false);
  const [animationTrigger, setAnimationTrigger] = useState(0);
  const [customToast, setCustomToast] = useState<string | null>(null);

  // ── Tap Buffering Refs ──────────────────────────────────────────────────────
  const pendingTapsRef = useRef<number>(0);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const walletAddressRef = useRef<string | null>(null);
  const prevActiveMonsterIdRef = useRef<string | null>(null);

  // Evolve state
  const [evolveModal, setEvolveModal] = useState(false);
  const [evolving, setEvolving] = useState(false);
  const [evolveTransition, setEvolveTransition] = useState<"idle" | "out" | "in">("idle");
  const [evolveMessage, setEvolveMessage] = useState<string | null>(null);
  const [showEvolveVideo, setShowEvolveVideo] = useState(false);
  const [videoFinished, setVideoFinished] = useState(false);
  const [evolveResult, setEvolveResult] = useState<any>(null);
  // Video UX state
  const [videoBuffering, setVideoBuffering] = useState(false); // true = belum siap diputar
  const [showSkip, setShowSkip] = useState(false);             // tombol skip muncul setelah 1.5 detik
  const videoTimeoutRef = useRef<NodeJS.Timeout | null>(null); // safety fallback timeout
  const skipTimerRef    = useRef<NodeJS.Timeout | null>(null); // timer munculnya tombol skip

  // Feed state
  const [feedModal, setFeedModal] = useState(false);
  const [feeding, setFeeding] = useState(false);

  // Day/Night state (defaulting to false/day to prevent hydration mismatch, set in useEffect)
  const [isNight, setIsNight] = useState<boolean>(false);

  useEffect(() => {
    const hour = new Date().getHours();
    setIsNight(hour >= 18 || hour < 6);
  }, []);

  // Initialize background music with dynamic source based on Day/Night
  const { isMuted, toggleMute } = useBackgroundMusic({
    src: isNight ? "/audio/dashboard-theme-night.mp3" : "/audio/dashboard-theme.mp3",
    volume: 0.25,
    loop: true,
  });

  // Show a mini toast
  const showToast = useCallback((msg: string) => {
    setCustomToast(msg);
    const timer = setTimeout(() => setCustomToast(null), 2500);
    return () => clearTimeout(timer);
  }, []);

  const triggerVisualAnimation = useCallback(() => {
    setAnimationTrigger((prev) => prev + 1);
  }, []);

  // ── Initial Fetch ───────────────────────────────────────────────────────────
  useEffect(() => {
    // TODO SECURITY: Wallet session via localStorage is a simplified testnet setup.
    // Replace with SIWE-style cryptographic proof (message signing) before mainnet.
    const wallet =
      typeof window !== "undefined"
        ? localStorage.getItem("siggy_wallet_address")
        : null;

    if (!wallet) {
      router.replace("/login");
      return;
    }
    walletAddressRef.current = wallet;

    async function fetchMonsters() {
      try {
        const url = `/api/monster/list?wallet=${encodeURIComponent(wallet!)}&t=${Date.now()}`;
        const res = await fetch(url, {
          headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
        });

        const contentLength = res.headers.get("Content-Length");
        const total = contentLength ? parseInt(contentLength, 10) : null;
        const reader = res.body?.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
              chunks.push(value);
              received += value.length;
              if (total) {
                setProgress(Math.min(99, Math.round((received / total) * 100)));
              }
            }
          }
        }

        const fullText = new TextDecoder().decode(
          new Uint8Array(chunks.reduce<number[]>((acc, c) => [...acc, ...c], []))
        );

        if (!res.ok) {
          const errBody = JSON.parse(fullText);
          if (res.status === 404) {
            localStorage.removeItem("siggy_wallet_address");
            router.replace("/login");
            return;
          }
          throw new Error(errBody.error ?? "Failed to summon your entities.");
        }

        const parsed: ApiResponse = JSON.parse(fullText);
        setProgress(100);
        setData(parsed);
      } catch (err: any) {
        setError(err.message ?? "An unknown error occurred.");
      } finally {
        setIsLoading(false);
      }
    }

    fetchMonsters();
  }, [router]);

  const activeMonster = useMemo(() => {
    if (!data?.monsters || data.monsters.length === 0) return null;
    const idx = activeIndex >= data.monsters.length ? 0 : activeIndex;
    return data.monsters[idx];
  }, [data, activeIndex]);

  // ── Tap Interaction ─────────────────────────────────────────────────────────
  const flushPendingTaps = useCallback(async (monsterIdToSync: string) => {
    if (pendingTapsRef.current === 0) return;
    
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }

    const tapsToSend = pendingTapsRef.current;
    pendingTapsRef.current = 0;
    
    const wallet = walletAddressRef.current;
    if (!wallet) return;

    setTapping(true);

    try {
      const res = await fetch("/api/monster/tap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          monsterId: monsterIdToSync,
          count: tapsToSend
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error ?? "Failed to sync taps with the Realms.");
        // If error (like energy exhausted), fetch fresh data to sync up
        const refreshUrl = `/api/monster/list?wallet=${encodeURIComponent(wallet)}&t=${Date.now()}`;
        const refreshRes = await fetch(refreshUrl);
        if (refreshRes.ok) {
          const refreshed = await refreshRes.json();
          setData(refreshed);
        }
        return;
      }

      // Reconcile client state with server response
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          monsters: prev.monsters.map((m) => {
            if (m.id !== monsterIdToSync) return m;

            // Apply any additional taps that happened while the request was in-flight
            const currentPending = pendingTapsRef.current;
            const updatedExp = json.monster.exp + (currentPending * 10);
            const updatedLevel = expToLevel(updatedExp);

            return {
              ...m,
              energy: Math.max(0, json.monster.energy - currentPending),
              exp: updatedExp,
              level: updatedLevel,
            };
          }),
        };
      });

      if (json.levelUp) {
        showToast("✨ The entity's consciousness has expanded! LEVEL UP!");
      }
    } catch (err) {
      showToast("Connection to the Realms disrupted.");
    } finally {
      setTapping(false);
    }
  }, [showToast]);

  const handleTap = useCallback(async () => {
    if (!activeMonster) return;

    // Check if monster still has energy (taking into account local pending taps)
    const currentOptimisticEnergy = activeMonster.energy;
    if (currentOptimisticEnergy <= 0) {
      showToast("⚡ Energy exhausted. Cannot interact right now.");
      return;
    }

    // 1. Optimistically update local UI state immediately (snappy!)
    pendingTapsRef.current += 1;
    
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        monsters: prev.monsters.map((m) => {
          if (m.id !== activeMonster.id) return m;
          const nextExp = m.exp + 10;
          const nextLevel = expToLevel(nextExp);
          return {
            ...m,
            energy: Math.max(0, m.energy - 1),
            exp: nextExp,
            level: nextLevel,
          };
        }),
      };
    });

    // 2. Debounce/schedule the sync API call
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    const currentMonsterId = activeMonster.id;
    debounceTimeoutRef.current = setTimeout(() => {
      flushPendingTaps(currentMonsterId);
    }, 300); // 300ms debounce window for snappier feel
  }, [activeMonster, showToast, flushPendingTaps]);

  // ── Effect: Flush taps when active monster changes ──────────────────────────
  useEffect(() => {
    if (prevActiveMonsterIdRef.current && prevActiveMonsterIdRef.current !== activeMonster?.id) {
      flushPendingTaps(prevActiveMonsterIdRef.current);
    }
    prevActiveMonsterIdRef.current = activeMonster?.id ?? null;
  }, [activeMonster?.id, flushPendingTaps]);

  // ── Effect: Flush taps when unmounting page ─────────────────────────────────
  useEffect(() => {
    return () => {
      if (prevActiveMonsterIdRef.current) {
        flushPendingTaps(prevActiveMonsterIdRef.current);
      }
    };
  }, [flushPendingTaps]);

  // ── Effect: Auto-clear Evolve Message ─────────────────────────────────────
  useEffect(() => {
    if (!evolveMessage) return;
    const timer = setTimeout(() => setEvolveMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [evolveMessage]);

  // ── Effect: Auto-clear Evolve Transition ──────────────────────────────────
  useEffect(() => {
    if (evolveTransition !== "in") return;
    const timer = setTimeout(() => setEvolveTransition("idle"), 700);
    return () => clearTimeout(timer);
  }, [evolveTransition]);

  // ── Effect: Preload ascension video ke browser cache saat dashboard mount ──
  // Menggunakan <link rel="preload"> programatik agar video sudah di-buffer
  // sebelum user klik Evolve, sehingga tidak ada blank black screen saat loading.
  // Pendekatan ini lebih ringan daripada hidden <video> element di DOM.
  useEffect(() => {
    const link = document.createElement("link");
    link.rel   = "preload";
    link.as    = "video";
    link.href  = "/video/ascension.mp4";
    document.head.appendChild(link);
    return () => {
      if (document.head.contains(link)) document.head.removeChild(link);
    };
  }, []);

  // ── Effect: Kelola timer video saat showEvolveVideo berubah ──────────────
  // - Saat video muncul: mulai safety timeout (8 detik) dan timer skip (1.5 detik)
  // - Saat video selesai/disembunyikan: bersihkan semua timer
  useEffect(() => {
    if (!showEvolveVideo) {
      // Bersihkan timer saat video disembunyikan
      if (videoTimeoutRef.current) clearTimeout(videoTimeoutRef.current);
      if (skipTimerRef.current)    clearTimeout(skipTimerRef.current);
      setVideoBuffering(false);
      setShowSkip(false);
      return;
    }

    // Saat video baru muncul: tampilkan indikator buffering
    setVideoBuffering(true);
    setShowSkip(false);

    // Safety timeout: kalau video belum selesai dalam 8 detik (gagal load,
    // network error, format tidak didukung), paksa lanjut — toh data evolusi
    // sudah tersimpan di DB, yang penting UI tidak stuck selamanya.
    videoTimeoutRef.current = setTimeout(() => {
      setVideoFinished(true);
    }, 8000);

    // Tombol skip: muncul setelah 1.5 detik agar user punya pilihan
    // kalau sudah sering evolve dan tidak mau nonton video penuh
    skipTimerRef.current = setTimeout(() => {
      setShowSkip(true);
    }, 1500);

    return () => {
      if (videoTimeoutRef.current) clearTimeout(videoTimeoutRef.current);
      if (skipTimerRef.current)    clearTimeout(skipTimerRef.current);
    };
  }, [showEvolveVideo]);

  // ── Handler: Video selesai, error, atau user klik Skip ───────────────────
  // Satu handler tunggal untuk ketiga skenario ini supaya tidak ada kode
  // duplikat dan timer selalu dibersihkan dengan benar.
  const handleVideoEnd = useCallback(() => {
    if (videoTimeoutRef.current) clearTimeout(videoTimeoutRef.current);
    if (skipTimerRef.current)    clearTimeout(skipTimerRef.current);
    setShowSkip(false);
    setVideoFinished(true);
  }, []);

  // ── Effect: Handle Evolution result after Video ends ─────────────────────
  useEffect(() => {
    if (!videoFinished || !evolveResult || !activeMonster) return;

    const json = evolveResult;

    // Phase 1: swap data
    if (json.monster) {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sig_balance: json.sig_balance ?? prev.sig_balance,
          monsters: prev.monsters.map((m) =>
            m.id === activeMonster.id
              ? {
                  ...m,
                  evolution_stage: json.monster.evolution_stage,
                  level:           json.monster.level,
                  exp:             json.monster.exp,
                  energy:          json.monster.energy,
                  monster_stats:   json.monster.monster_stats,
                  monster_food_bonus: json.monster.monster_food_bonus,
                }
              : m
          ),
        };
      });
    } else if (json.newStage) {
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sig_balance: json.sig_balance ?? prev.sig_balance,
          monsters: prev.monsters.map((m) =>
            m.id === activeMonster.id
              ? { ...m, evolution_stage: json.newStage }
              : m
          ),
        };
      });
    }

    // Phase 2: trigger fade-in animation
    setEvolveTransition("in");
    const stageName = json.newStage?.replace(/_/g, " ") ?? "next stage";
    const monName = activeMonster.nickname ?? activeMonster.species.name;
    setEvolveMessage(`✨ ${monName} has ascended to ${stageName}!`);

    // Reset evolution states
    setShowEvolveVideo(false);
    setVideoFinished(false);
    setEvolveResult(null);
    setEvolving(false);
    refreshStats();
  }, [videoFinished, evolveResult, activeMonster, refreshStats]);

  // ── Evolve Handler ─────────────────────────────────────────────────────────
  const handleConfirmEvolve = useCallback(async () => {
    if (!activeMonster || evolving) return;
    const wallet = localStorage.getItem("siggy_wallet_address");
    if (!wallet) return;

    setEvolveModal(false);
    setEvolving(true);
    setShowEvolveVideo(true);
    setVideoFinished(false);
    setEvolveResult(null);

    // Phase 1: fade-out current monster artwork in background
    setEvolveTransition("out");

    try {
      const res = await fetch("/api/monster/evolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: wallet, monsterId: activeMonster.id }),
      });
      const json = await res.json();

      if (!res.ok) {
        setShowEvolveVideo(false);
        setEvolveTransition("idle");
        setEvolving(false);
        showToast(json.error ?? "The evolution ritual was disrupted.");
        return;
      }

      setEvolveResult(json);
    } catch (err) {
      setShowEvolveVideo(false);
      setEvolveTransition("idle");
      setEvolving(false);
      showToast("Connection to the Realms disrupted during evolution.");
    }
  }, [activeMonster, evolving, showToast]);

  // ── Feed Handler ───────────────────────────────────────────────────────────
  const handleFeed = useCallback(async (foodKey: string) => {
    if (!activeMonster || feeding) return;
    const wallet = localStorage.getItem("siggy_wallet_address");
    if (!wallet) return;

    setFeeding(true);

    try {
      const res = await fetch("/api/monster/feed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          monsterId: activeMonster.id,
          foodKey,
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        showToast(json.error ?? "Something interrupted the feeding ritual.");
        return;
      }

      // Update local state (stats, satiety, inventory quantities)
      setData((prev) => {
        if (!prev) return prev;

        const updatedMonsters = prev.monsters.map((m) =>
          m.id === activeMonster.id
            ? {
                ...m,
                satiety: json.monster.satiety,
                monster_food_bonus: json.monster.monster_food_bonus,
              }
            : m
        );

        const updatedInventory = prev.inventory
          .map((item) =>
            item.food_key === foodKey
              ? { ...item, quantity: json.remaining_quantity }
              : item
          )
          .filter((item) => item.quantity > 0);

        return {
          ...prev,
          monsters:  updatedMonsters,
          inventory: updatedInventory,
        };
      });

      showToast(json.feed_message ?? "Your entity has been nourished!");
      setFeedModal(false);
    } catch (err) {
      showToast("The feeding ritual was interrupted. Connection unstable.");
    } finally {
      setFeeding(false);
    }
  }, [activeMonster, feeding, showToast]);

  // ── Disconnect Wallet ──────────────────────────────────────────────────────
  const handleDisconnect = useCallback(() => {
    const confirmDis = window.confirm(
      "Do you wish to sever your binding and leave the Realms?"
    );
    if (confirmDis) {
      localStorage.removeItem("siggy_wallet_address");
      router.push("/login");
    }
  }, [router]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <LoadingScreen
        progress={progress}
        tips={[
          "Awakening the ancient link to the database…",
          "Consulting the Ritual network state…",
          "Preparing the dashboard void…",
        ]}
      />
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0b14] p-6">
        <div className="text-center space-y-4">
          <p className="text-red-400 font-mono">{error}</p>
          <button
            onClick={() => router.push("/login")}
            className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors"
          >
            Return to Ritual Gate
          </button>
        </div>
      </main>
    );
  }

  const wallet =
    typeof window !== "undefined"
      ? localStorage.getItem("siggy_wallet_address") ?? ""
      : "";

  const hasMonsters = data?.monsters && data.monsters.length > 0;
  const monsterElement = activeMonster?.species.element ?? "dark";
  const elementStyle = ELEMENT_COLORS[monsterElement] ?? ELEMENT_COLORS.dark;
  const activeImgPath = activeMonster
    ? `/monsters/${activeMonster.species_key}/${activeMonster.evolution_stage}.png`
    : null;

  // Level & EXP Progress
  const expInfo = activeMonster
    ? expProgressInLevel(activeMonster.exp)
    : { current: 0, needed: 100, percentage: 0 };

  // Evolve eligibility (computed each render from local state)
  const nextEvolvableStage = activeMonster
    ? canEvolveToNextStage(
        activeMonster.evolution_stage as EvolutionStage,
        activeMonster.level
      )
    : null;

  const isMaxStage = activeMonster?.evolution_stage === "radiant_ritualist";
  const sigNeeded  = nextEvolvableStage?.evolveCostSig ?? 0;
  const sigReward  = nextEvolvableStage?.evolveRewardSig ?? 0;
  const canEvolve  = !!nextEvolvableStage && sigBalance >= sigNeeded;

  let evolveDisabledReason: string | null = null;
  if (!activeMonster || isMaxStage) {
    evolveDisabledReason = "Max stage reached";
  } else if (!nextEvolvableStage) {
    const nextStageObj = EVOLUTION_STAGES.find(
      (s) => s.minLevel > (activeMonster?.level ?? 0)
    );
    evolveDisabledReason = nextStageObj
      ? `Requires Level ${nextStageObj.minLevel}`
      : "Max stage reached";
  } else if (sigBalance < sigNeeded) {
    evolveDisabledReason = `Need ${sigNeeded} SIG`;
  }

  const textShadowStyle = { textShadow: "0 1px 4px rgba(0,0,0,0.8)" };

  return (
    <main className="relative min-h-screen w-full text-white overflow-hidden select-none flex flex-col justify-between">
      {/* ── 1. BACKGROUND (Full-bleed) ── */}
      <div className="absolute inset-0 w-full h-full -z-20 overflow-hidden">
        {/* Day Background */}
        <Image
          src="/branding/dashboard-background.png"
          alt="Ancient Siggy Realm - Day"
          fill
          priority
          className="object-cover object-center pointer-events-none"
        />
        {/* Night Background Overlay with smooth opacity transition */}
        <div
          style={{
            opacity: isNight ? 1 : 0,
            transition: "opacity 1.5s ease-in-out",
          }}
          className="absolute inset-0 w-full h-full"
        >
          <Image
            src="/branding/dashboard-background-night.png"
            alt="Ancient Siggy Realm - Night"
            fill
            priority
            className="object-cover object-center pointer-events-none"
          />
        </div>
        <div className="absolute inset-0 bg-black/35 pointer-events-none" />
      </div>

      {/* Toast Alert overlay */}
      {customToast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full bg-black/85 border border-white/10 backdrop-blur-md text-sm text-violet-300 font-mono animate-fade-in shadow-xl shadow-black/40">
          {customToast}
        </div>
      )}

      {/* Evolve Ascension Message overlay */}
      {evolveMessage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className="px-10 py-5 rounded-2xl bg-black/70 border border-violet-500/40 backdrop-blur-md text-center shadow-2xl shadow-violet-900/50">
            <p className="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-violet-300 to-amber-300 tracking-wide">
              {evolveMessage}
            </p>
          </div>
        </div>
      )}

      {/* ── Evolution Cinematic Video Overlay ── */}
      {showEvolveVideo && (
        <div className="fixed inset-0 z-50 bg-black flex items-center justify-center animate-fade-in">

          {/* Indikator buffering — tampil selama video belum siap diputar */}
          {videoBuffering && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-10">
              <p className="text-white/45 text-[11px] font-mono tracking-[0.35em] uppercase animate-pulse">
                The crystal is resonating…
              </p>
            </div>
          )}

          {/* Video — preload="auto" agar browser lanjutkan buffering yang dimulai
              saat dashboard pertama kali dibuka (via <link rel="preload"> di useEffect).
              onError = treat error sama seperti video selesai normal, karena data
              evolusi SUDAH tersimpan di DB sebelum video muncul — UI harus tetap lanjut.
              onCanPlay = sembunyikan indikator buffering saat video siap. */}
          <video
            src="/video/ascension.mp4"
            autoPlay
            playsInline
            preload="auto"
            className="w-full h-full object-contain"
            onCanPlay={() => setVideoBuffering(false)}
            onEnded={handleVideoEnd}
            onError={handleVideoEnd}
          />

          {/* Tombol Skip — muncul setelah 1.5 detik, pojok kanan bawah.
              Berguna untuk user yang sudah familiar dengan animasi ini. */}
          {showSkip && (
            <button
              onClick={handleVideoEnd}
              className="absolute bottom-8 right-8 px-4 py-2 rounded-full bg-black/50 border border-white/20 text-white/55 text-[11px] font-mono tracking-widest hover:bg-black/70 hover:text-white/90 hover:border-white/40 transition-all backdrop-blur-sm active:scale-95 animate-fade-in"
            >
              Skip ↩
            </button>
          )}
        </div>
      )}

      {/* ── Evolve Confirmation Modal ── */}
      {evolveModal && nextEvolvableStage && activeMonster && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setEvolveModal(false)}
        >
          <div
            className="relative w-[340px] rounded-2xl bg-[#0d0b14]/95 border border-violet-500/30 p-7 shadow-2xl shadow-violet-900/60"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-extrabold text-white tracking-wide mb-1">
              Begin the Ascension Ritual?
            </h3>
            <p className="text-white/50 text-xs mb-6">
              {activeMonster.nickname ?? activeMonster.species.name} will evolve into{" "}
              <span className="text-violet-300 font-semibold capitalize">
                {nextEvolvableStage.stage.replace(/_/g, " ")}
              </span>
              .
            </p>

            <div className="rounded-xl bg-white/5 border border-white/8 divide-y divide-white/8 mb-6 overflow-hidden">
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-white/50 text-xs">Cost</span>
                <span className="text-red-400 font-bold text-sm font-mono">
                  −{sigNeeded} SIG
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <span className="text-white/50 text-xs">Reward</span>
                <span className="text-emerald-400 font-bold text-sm font-mono">
                  +{sigReward} SIG
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5 bg-white/5">
                <span className="text-white/70 text-xs font-semibold">Net Change</span>
                <span
                  className={`font-extrabold text-sm font-mono ${
                    sigReward - sigNeeded >= 0 ? "text-emerald-300" : "text-red-300"
                  }`}
                >
                  {sigReward - sigNeeded >= 0 ? "+" : ""}
                  {sigReward - sigNeeded} SIG
                </span>
              </div>
            </div>

            <div className="text-[10px] text-white/30 mb-5 text-center font-mono">
              Base stats will be scaled ×1.5 · Food bonuses unchanged
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setEvolveModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white/50 bg-white/5 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmEvolve}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 transition-all shadow-lg active:scale-[0.97]"
              >
                Confirm Ascension
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Feed Selector Modal ── */}
      {feedModal && activeMonster && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setFeedModal(false)}
        >
          <div
            className="relative w-[340px] rounded-2xl bg-[#0d0b14]/95 border border-violet-500/30 p-7 shadow-2xl shadow-violet-900/60"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-xl font-extrabold text-white tracking-wide mb-1">
              Feed Entity
            </h3>
            <p className="text-white/50 text-xs mb-5">
              Select nourishment from your vault inventory to sustain your Siggy.
            </p>

            {data?.inventory && data.inventory.filter((item) => item.quantity > 0).length > 0 ? (
              <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                {data.inventory
                  .filter((item) => item.quantity > 0)
                  .map((item) => {
                    const foodDef = FOODS[item.food_key as FoodKey];
                    if (!foodDef) return null;
                    const effectEntries = Object.entries(foodDef.effect);
                    const effectDesc = effectEntries
                      .map(([stat, val]) => `+${val} ${stat.toUpperCase()}`)
                      .join(", ");
                    
                    const emoji =
                      item.food_key === "berry" ? "🍒" :
                      item.food_key === "meat" ? "🥩" :
                      item.food_key === "shell" ? "🐚" :
                      item.food_key === "feather" ? "🪶" :
                      item.food_key === "crystal" ? "💎" : "💨";

                    return (
                      <div
                        key={item.food_key}
                        className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-all"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{emoji}</span>
                          <div>
                            <p className="text-xs font-bold text-white capitalize">
                              {foodDef.name}
                            </p>
                            <p className="text-[10px] text-violet-300 font-semibold">
                              {effectDesc} (Permanen)
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] text-white/50 font-mono font-bold">
                            Qty: {item.quantity}
                          </span>
                          <button
                            onClick={() => handleFeed(item.food_key)}
                            disabled={feeding || activeMonster.satiety < 10}
                            className={`px-3 py-1 rounded-lg text-[10px] font-bold tracking-wider transition-all ${
                              activeMonster.satiety < 10
                                ? "bg-white/5 text-white/30 cursor-not-allowed"
                                : "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white"
                            }`}
                          >
                            Feed
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="text-center py-6">
                <p className="text-white/40 text-xs mb-4">
                  No food available in your inventory.
                </p>
                <button
                  onClick={() => {
                    setFeedModal(false);
                    router.push("/shop");
                  }}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold border border-white/10 transition-colors"
                >
                  🛒 Go to Alchemy Bazaar
                </button>
              </div>
            )}

            <div className="text-[10px] text-white/30 mt-5 mb-4 text-center font-mono">
              Feeding costs 10 satiety capacity · current: {activeMonster.satiety}/100
            </div>

            <button
              onClick={() => setFeedModal(false)}
              className="w-full py-2 rounded-xl text-xs font-semibold text-white/50 bg-white/5 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── 2. TOP BAR ── */}
      <header className="w-full z-40 px-6 py-4 flex items-center justify-between pointer-events-auto">
        {/* Left: Wallet Indicator */}
        <div
          onClick={handleDisconnect}
          className="flex items-center gap-2 cursor-pointer group bg-black/30 hover:bg-black/45 px-3.5 py-2 rounded-full border border-white/5 backdrop-blur-md transition-all shadow-md"
          title="Click to disconnect"
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-white/80 text-xs font-mono group-hover:text-red-400 transition-colors">
            Bound: {wallet.slice(0, 6)}…{wallet.slice(-4)}
          </span>
        </div>

        {/* Middle: Brand Title */}
        <h1 className="text-xl font-bold tracking-[0.25em] text-white/95 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] font-sans">
          SIGGY REALMS
        </h1>

        {/* Right: User Twitter avatar & handle + Audio Toggle + Day/Night Toggle */}
        <div className="flex items-center gap-2">
          {/* Day/Night toggle button */}
          <button
            onClick={() => setIsNight((prev) => !prev)}
            className="w-9 h-9 rounded-full bg-black/30 hover:bg-black/45 border border-white/5 backdrop-blur-md flex items-center justify-center text-xs transition-all active:scale-95 shadow-md"
            title={isNight ? "Switch to Day Mode" : "Switch to Night Mode"}
          >
            {isNight ? "🌙" : "☀️"}
          </button>

          {/* Mute toggle button */}
          <button
            onClick={toggleMute}
            className="w-9 h-9 rounded-full bg-black/30 hover:bg-black/45 border border-white/5 backdrop-blur-md flex items-center justify-center text-xs transition-all active:scale-95 shadow-md"
            title={isMuted ? "Unmute Ambient Music" : "Mute Ambient Music"}
          >
            {isMuted ? "🔇" : "🔊"}
          </button>

          <div className="flex items-center gap-2 bg-black/30 px-3.5 py-2 rounded-full border border-white/5 backdrop-blur-md shadow-md">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-xs font-bold text-white uppercase font-mono shadow-sm">
              {data?.twitter_handle?.slice(0, 2) ?? "X"}
            </div>
            <span className="text-white/90 text-xs font-mono">
              @{data?.twitter_handle ?? "player"}
            </span>
          </div>
        </div>
      </header>

      {/* ── 3. CENTER MONSTER STAGE (Centered in full Viewport) ── */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <section className="flex flex-col items-center justify-center pointer-events-auto">
          {hasMonsters && activeMonster && activeImgPath ? (
            <>
              {/* Radial Glow color matching the element of the Siggy */}
              <div
                className={`absolute w-[440px] h-[440px] rounded-full bg-gradient-to-r ${elementStyle.glow} to-transparent blur-[80px] opacity-75 -z-10 pointer-events-none transition-all duration-500`}
              />

              {/* Monster selector arrows if user has multiple Siggies */}
              {data.monsters.length > 1 && (
                <div className="absolute inset-x-[-140px] top-[180px] -translate-y-1/2 flex justify-between pointer-events-none z-20 w-[640px] mx-auto">
                  <button
                    onClick={() =>
                      setActiveIndex((prev) =>
                        prev === 0 ? data.monsters.length - 1 : prev - 1
                      )
                    }
                    className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 border border-white/10 flex items-center justify-center text-white font-mono pointer-events-auto backdrop-blur-md transition-all hover:scale-110 active:scale-90 shadow-md"
                  >
                    &lt;
                  </button>
                  <button
                    onClick={() =>
                      setActiveIndex((prev) =>
                        prev === data.monsters.length - 1 ? 0 : prev + 1
                      )
                    }
                    className="w-10 h-10 rounded-full bg-black/40 hover:bg-black/60 border border-white/10 flex items-center justify-center text-white font-mono pointer-events-auto backdrop-blur-md transition-all hover:scale-110 active:scale-90 shadow-md"
                  >
                    &gt;
                  </button>
                </div>
              )}

              {/* Image & Tap area — also applies evolve transition opacity/scale */}
              <div
                key={animationTrigger}
                onClick={() => {
                  triggerVisualAnimation();
                  handleTap();
                }}
                style={{
                  opacity:   evolveTransition === "out" ? 0 : 1,
                  transform: evolveTransition === "out" ? "scale(0.85)" : evolveTransition === "in" ? "scale(1.05)" : "scale(1)",
                  transition: "opacity 0.45s ease, transform 0.45s ease",
                }}
                className={`relative w-[360px] h-[360px] cursor-pointer group select-none ${
                  animationTrigger > 0 ? "animate-tap-effect" : ""
                }`}
              >
                <Image
                  src={activeImgPath}
                  alt={activeMonster.species.name}
                  fill
                  priority
                  className="object-contain drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)] group-hover:scale-105 transition-transform duration-300"
                />
              </div>

              {/* Tap to interact instruction */}
              <p 
                style={textShadowStyle}
                className="mt-6 text-[10px] uppercase tracking-[0.3em] text-white/70 font-semibold text-center animate-pulse"
              >
                {tapping ? "Channeling Ritual…" : "Tap Entity to Interact"}
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center text-center gap-4 pointer-events-auto">
              <p className="text-6xl opacity-30 animate-pulse">🔮</p>
              <p style={textShadowStyle} className="text-white/80 text-sm max-w-xs font-sans font-medium">
                The stage is dormant. Awaken a Genesis Crystal to begin.
              </p>
              <button
                onClick={() => router.push("/mint")}
                className="px-6 py-2.5 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-xs font-semibold tracking-wider transition-all shadow-lg"
              >
                🔮 Awaken Crystal
              </button>
            </div>
          )}
        </section>
      </div>

      {/* ── LEFT & RIGHT FLOATING OVERLAY PANELS ── */}
      <div className="flex-1 w-full max-w-7xl mx-auto px-6 flex justify-between items-center z-20 pointer-events-none min-h-[500px]">
        
        {/* MASALAH 1 & 4 — LEFT PANEL: Menu List (Floating with Backdrop blur) */}
        <aside 
          className="w-64 p-6 rounded-2xl bg-black/25 backdrop-blur-[8px] pointer-events-auto flex flex-col gap-4 shadow-xl border border-white/5"
        >
          <h3 
            style={textShadowStyle}
            className="text-[11px] uppercase tracking-[0.2em] text-white/80 font-bold border-b border-white/10 pb-2 mb-1"
          >
            Realms Codex
          </h3>
          <nav className="flex flex-col gap-4">
            {MENU_ITEMS.map((item) => {
              const isV1Excluded = item.scope === "excluded_v1";
              return (
                <span
                  key={item.label}
                  onClick={() => {
                    if (item.label === "Shop") {
                      router.push("/shop");
                    } else if (item.label === "Daily Quest") {
                      router.push("/quest");
                    } else if (item.label === "Arena") {
                      router.push("/arena");
                    } else if (isV1Excluded) {
                      showToast(`⚔️ ${item.label} is excluded from scope V1.`);
                    } else {
                      showToast(`🔮 ${item.label} will be available in the upcoming week.`);
                    }
                  }}
                  style={textShadowStyle}
                  className={`text-sm font-semibold cursor-pointer tracking-wider transition-colors hover:text-white ${
                    isV1Excluded ? "text-white/35 hover:text-white/50" : "text-white/85"
                  }`}
                >
                  {item.label}
                </span>
              );
            })}
          </nav>
        </aside>

        {/* MASALAH 3 — RIGHT PANEL: Monster Info Panel (Floating with Backdrop blur) */}
        <aside 
          className="w-80 p-6 rounded-2xl bg-black/25 backdrop-blur-[8px] pointer-events-auto flex flex-col gap-5 shadow-xl border border-white/5"
        >
          {activeMonster ? (
            <div className="space-y-5">
              {/* Name & element info */}
              <div style={textShadowStyle}>
                <h2 className="text-2xl font-extrabold tracking-wide text-white drop-shadow-md leading-tight">
                  {activeMonster.nickname ?? activeMonster.species.name}
                </h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-xs font-bold uppercase tracking-wider ${elementStyle.text}`}>
                    {activeMonster.species.element}
                  </span>
                  <span className="text-white/40 text-xs">•</span>
                  <span className="text-white/70 text-xs">
                    {activeMonster.species.role}
                  </span>
                </div>
              </div>

              {/* Level & EXP Progress */}
              <div className="space-y-1.5" style={textShadowStyle}>
                <div className="flex justify-between items-baseline">
                  <span className="text-[10px] tracking-widest text-white/70 font-bold font-mono">
                    LEVEL {activeMonster.level}
                  </span>
                  <span className="text-[10px] text-white/70 font-mono">
                    EXP: {expInfo.current}/{expInfo.needed}
                  </span>
                </div>
                <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-400 to-purple-400 rounded-full transition-all duration-300"
                    style={{ width: `${expInfo.percentage}%` }}
                  />
                </div>
                <p className="text-[9px] text-white/70 font-mono uppercase tracking-wider">
                  Evolution Stage: {activeMonster.evolution_stage}
                </p>
              </div>

              {/* Stats grid (calculated: base + food bonus) */}
              <div className="space-y-3 pt-2" style={textShadowStyle}>
                <h3 className="text-[10px] uppercase tracking-[0.2em] text-white/70 font-extrabold border-b border-white/10 pb-1.5">
                  Attributes
                </h3>
                <div className="grid grid-cols-2 gap-3.5">
                  {(
                    [
                      ["HP",    activeMonster.monster_stats.hp,    activeMonster.monster_food_bonus.hp_bonus],
                      ["ATK",   activeMonster.monster_stats.atk,   activeMonster.monster_food_bonus.atk_bonus],
                      ["DEF",   activeMonster.monster_stats.def,   activeMonster.monster_food_bonus.def_bonus],
                      ["SPD",   activeMonster.monster_stats.spd,   activeMonster.monster_food_bonus.spd_bonus],
                      ["CRIT",  activeMonster.monster_stats.crit,  activeMonster.monster_food_bonus.crit_bonus,  "%"],
                      ["DODGE", activeMonster.monster_stats.dodge, activeMonster.monster_food_bonus.dodge_bonus, "%"],
                    ] as [string, number, number, string?][]
                  ).map(([lbl, base, bonus, suffix]) => {
                    const total = base + bonus;
                    return (
                      <div key={lbl} className="flex flex-col">
                        <span className="text-[10px] text-white/70 uppercase tracking-wider font-semibold">
                          {lbl}
                        </span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-lg font-bold text-white tracking-tight">
                            {total}
                            {suffix}
                          </span>
                          {bonus > 0 && (
                            <span className="text-[10px] text-emerald-400 font-mono font-bold">
                              +{bonus}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => setFeedModal(true)}
                  className={`flex-1 py-2.5 px-4 rounded-xl font-bold text-xs text-white tracking-wider transition-all duration-150 active:scale-95 shadow-md ${elementStyle.btn}`}
                >
                  Feed
                </button>

                {/* Evolve button — disabled with tooltip if not eligible */}
                <div className="relative flex-1 group">
                  <button
                    onClick={() => canEvolve && !evolving && setEvolveModal(true)}
                    disabled={!canEvolve || evolving}
                    className={`w-full py-2.5 px-4 rounded-xl font-bold text-xs tracking-wider transition-all duration-150 ${
                      canEvolve && !evolving
                        ? `bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white active:scale-95 shadow-lg`
                        : `bg-white/5 text-white/35 border ${elementStyle.border} cursor-not-allowed`
                    }`}
                  >
                    {evolving ? "Awakening…" : "Evolve"}
                  </button>
                  {/* Tooltip for disabled reason */}
                  {evolveDisabledReason && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1 rounded-lg bg-black/80 border border-white/10 text-[10px] text-white/70 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                      {evolveDisabledReason}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div style={textShadowStyle} className="text-white/70 text-xs font-mono text-center">
              Select or summon an entity to view its attributes.
            </div>
          )}
        </aside>
      </div>

      {/* ── 5. BOTTOM HUD (No horizontal menu items, clean look) ── */}
      <footer className="w-full z-30 px-6 pb-6 pt-2 pointer-events-auto">
        <div className="max-w-4xl mx-auto flex items-center justify-between bg-black/35 backdrop-blur-md border border-white/5 rounded-full px-6 py-3 shadow-lg shadow-black/25">
          
          {/* Left indicator: Energy */}
          <div className="flex items-center gap-2">
            <span className="text-sky-400 text-base animate-pulse">⚡</span>
            <span className="text-sm font-semibold tracking-wider font-mono text-white/90">
              {activeMonster ? `${activeMonster.energy}/300` : "0/300"}
            </span>
            <span className="text-[10px] text-white/40 tracking-wider">ENERGY</span>
          </div>

          <div className="hidden md:block text-[11px] text-white/35 font-mono tracking-widest uppercase">
            Ritual Network Testnet
          </div>

          {/* Right indicator: SIG Balance */}
          <div className="flex items-center gap-1.5">
            <span className="text-amber-400 text-sm">✦</span>
            <span className="text-sm font-semibold tracking-wider font-mono text-white/90">
              {sigBalance}
            </span>
            <span className="text-[10px] text-white/40 tracking-wider">SIG</span>
          </div>

        </div>
      </footer>

      {/* Custom Styles for Snappy Tap Animations */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes tapScaleAndFlash {
          0% { transform: scale(1); filter: brightness(1); }
          15% { transform: scale(0.92); filter: brightness(2.0); }
          30% { transform: scale(1.0); filter: brightness(1.5); }
          50% { transform: scale(1.07); filter: brightness(1.1); }
          100% { transform: scale(1); filter: brightness(1); }
        }
        .animate-tap-effect {
          animation: tapScaleAndFlash 0.28s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
        }
      `}} />
    </main>
  );
}
