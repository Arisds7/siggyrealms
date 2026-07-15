"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import LoadingScreen from "@/components/ui/LoadingScreen";

import { useUserStats } from "@/lib/context/UserStatsContext";

interface QuestProgress {
  progress: number;
  target: number;
  claimed: boolean;
  reward: number;
}

interface DailyQuests {
  quest_date: string;
  login: QuestProgress;
  tap: QuestProgress;
  feed: QuestProgress;
}

interface LimitedTasks {
  follow: boolean;
  like: boolean;
  retweet: boolean;
}

interface ApiResponse {
  sig_balance: number;
  daily_quests: DailyQuests;
  limited_tasks: LimitedTasks;
}

export default function QuestPage() {
  const router = useRouter();
  const { sigBalance, refresh: refreshStats } = useUserStats();
  const [dailyQuests, setDailyQuests] = useState<DailyQuests | null>(null);
  const [limitedTasks, setLimitedTasks] = useState<LimitedTasks | null>(null);
  const [twitterHandle, setTwitterHandle] = useState<string>("player");
  
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<Record<string, boolean>>({});
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, []);

  // ── Fetch Quests data on mount ─────────────────────────────────────────────
  const fetchQuests = useCallback(async (wallet: string) => {
    try {
      const res = await fetch(
        `/api/quest/list?wallet=${encodeURIComponent(wallet)}&t=${Date.now()}`,
        { headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" } }
      );
      if (!res.ok) {
        throw new Error("The Quest Codex failed to answer your call. Try again.");
      }
      const data: ApiResponse = await res.json();
      setDailyQuests(data.daily_quests);
      setLimitedTasks(data.limited_tasks);

      // Fetch twitter handle from monster/list endpoint
      const userRes = await fetch(
        `/api/monster/list?wallet=${encodeURIComponent(wallet)}&t=${Date.now()}`,
        { headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" } }
      );
      if (userRes.ok) {
        const userData = await userRes.json();
        if (userData.twitter_handle) {
          setTwitterHandle(userData.twitter_handle);
        }
      }
    } catch (err: any) {
      setError(err.message ?? "A tremor disrupted the Codex transmission. Try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const wallet =
      typeof window !== "undefined"
        ? localStorage.getItem("siggy_wallet_address")
        : null;

    if (!wallet) {
      router.replace("/login");
      return;
    }

    fetchQuests(wallet);
    refreshStats();
  }, [router, fetchQuests, refreshStats]);

  // ── Claim Handler ──────────────────────────────────────────────────────────
  const handleClaim = async (type: "daily" | "limited", questKey: string) => {
    const wallet = localStorage.getItem("siggy_wallet_address");
    if (!wallet) return;

    const actionKey = `${type}-${questKey}`;
    setClaiming((prev) => ({ ...prev, [actionKey]: true }));

    try {
      const res = await fetch("/api/quest/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          type,
          questKey,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error ?? "The Vault rejected the ritual. Claim denied.");
        return;
      }

      await refreshStats();
      showToast(data.message ?? "Reward channelled to your Vault!");
      
      // Refresh quest status data from server
      await fetchQuests(wallet);
    } catch (err) {
      showToast("The Vault channel collapsed. Check your connection.");
    } finally {
      setClaiming((prev) => ({ ...prev, [actionKey]: false }));
    }
  };

  if (isLoading) {
    return (
      <LoadingScreen
        tips={[
          "Opening the Quest Codex portal…",
          "Synchronising your daily rites…",
          "Reading your covenant contributions on Ritual Network…",
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

  // Twitter Limited Tasks link configuration
  const TWITTER_LINKS = {
    follow: "https://twitter.com/intent/follow?screen_name=@universenga",
    like: "https://twitter.com/intent/like?tweet_id=2061357778787307895",
    retweet: "https://twitter.com/intent/retweet?tweet_id=2061357778787307895",
  };

  return (
    <main className="relative min-h-screen w-full text-white overflow-x-hidden select-none flex flex-col justify-between">
      {/* ── BACKGROUND (Full-bleed, matching Dashboard & Shop) ── */}
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
          QUEST CODEX
        </h1>

        {/* Right: User Twitter & Current SIG Balance */}
        <div className="flex items-center gap-3">
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

      {/* ── MAIN CONTENT AREA ── */}
      <div className="flex-1 w-full max-w-5xl mx-auto px-6 flex flex-col justify-center py-8 z-20 gap-10">
        
        {/* SECTION 1: DAILY QUESTS */}
        <div>
          <div className="mb-6 text-center">
            <h2 style={textShadowStyle} className="text-2xl font-bold tracking-wide">Daily Rituals</h2>
            <p style={textShadowStyle} className="text-white/70 text-xs mt-1 font-mono uppercase">
              Complete these tasks everyday. Resets daily based on UTC timezone.
            </p>
          </div>

          {dailyQuests && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Card 1: Login */}
              <div className="relative p-5 rounded-2xl bg-black/25 backdrop-blur-[8px] border border-white/5 shadow-xl flex flex-col justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl relative overflow-hidden shadow-inner flex-shrink-0">
                    <span className="z-10">🔮</span>
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold tracking-wide text-white">Daily Login</h3>
                    <p className="text-white/60 text-[11px] mt-0.5 leading-relaxed">
                      Emerge in the Realms of consciousness today.
                    </p>
                    <p className="text-[10px] text-violet-300 font-mono mt-1 font-bold">
                      Reward: +50 SIG
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-white/5">
                  <div className="flex justify-between text-[10px] font-mono text-white/50">
                    <span>Progress</span>
                    <span>{dailyQuests.login.claimed ? "1 / 1" : `${dailyQuests.login.progress} / ${dailyQuests.login.target}`}</span>
                  </div>
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-400 rounded-full transition-all duration-300"
                      style={{ width: dailyQuests.login.claimed ? "100%" : `${(dailyQuests.login.progress / dailyQuests.login.target) * 100}%` }}
                    />
                  </div>

                  <button
                    onClick={() => handleClaim("daily", "login")}
                    disabled={dailyQuests.login.claimed || dailyQuests.login.progress < dailyQuests.login.target || claiming["daily-login"]}
                    className={`w-full py-2 rounded-xl font-bold text-xs transition-all active:scale-[0.98] ${
                      dailyQuests.login.claimed
                        ? "bg-white/5 text-white/30 cursor-not-allowed border border-white/5"
                        : dailyQuests.login.progress >= dailyQuests.login.target
                        ? "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-md shadow-violet-900/20"
                        : "bg-white/5 text-white/40 cursor-not-allowed border border-white/5"
                    }`}
                  >
                    {claiming["daily-login"] ? "Claiming…" : dailyQuests.login.claimed ? "Claimed" : "Claim Reward"}
                  </button>
                </div>
              </div>

              {/* Card 2: Tapping */}
              <div className="relative p-5 rounded-2xl bg-black/25 backdrop-blur-[8px] border border-white/5 shadow-xl flex flex-col justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl relative overflow-hidden shadow-inner flex-shrink-0">
                    <span className="z-10">⚡</span>
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold tracking-wide text-white">Channelling Ritual</h3>
                    <p className="text-white/60 text-[11px] mt-0.5 leading-relaxed">
                      Tap your entity 100 times to project consciousness.
                    </p>
                    <p className="text-[10px] text-violet-300 font-mono mt-1 font-bold">
                      Reward: +100 SIG
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-white/5">
                  <div className="flex justify-between text-[10px] font-mono text-white/50">
                    <span>Progress</span>
                    <span>{dailyQuests.tap.claimed ? "100 / 100" : `${Math.min(dailyQuests.tap.target, dailyQuests.tap.progress)} / ${dailyQuests.tap.target}`}</span>
                  </div>
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-400 rounded-full transition-all duration-300"
                      style={{ width: dailyQuests.tap.claimed ? "100%" : `${Math.min(100, (dailyQuests.tap.progress / dailyQuests.tap.target) * 100)}%` }}
                    />
                  </div>

                  <button
                    onClick={() => handleClaim("daily", "tap")}
                    disabled={dailyQuests.tap.claimed || dailyQuests.tap.progress < dailyQuests.tap.target || claiming["daily-tap"]}
                    className={`w-full py-2 rounded-xl font-bold text-xs transition-all active:scale-[0.98] ${
                      dailyQuests.tap.claimed
                        ? "bg-white/5 text-white/30 cursor-not-allowed border border-white/5"
                        : dailyQuests.tap.progress >= dailyQuests.tap.target
                        ? "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-md shadow-violet-900/20"
                        : "bg-white/5 text-white/40 cursor-not-allowed border border-white/5"
                    }`}
                  >
                    {claiming["daily-tap"] ? "Claiming…" : dailyQuests.tap.claimed ? "Claimed" : "Claim Reward"}
                  </button>
                </div>
              </div>

              {/* Card 3: Feeding */}
              <div className="relative p-5 rounded-2xl bg-black/25 backdrop-blur-[8px] border border-white/5 shadow-xl flex flex-col justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl relative overflow-hidden shadow-inner flex-shrink-0">
                    <span className="z-10">🥩</span>
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold tracking-wide text-white">Nourish Entity</h3>
                    <p className="text-white/60 text-[11px] mt-0.5 leading-relaxed">
                      Provide feed once to stabilize the entity's attributes.
                    </p>
                    <p className="text-[10px] text-violet-300 font-mono mt-1 font-bold">
                      Reward: +50 SIG
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-2 border-t border-white/5">
                  <div className="flex justify-between text-[10px] font-mono text-white/50">
                    <span>Progress</span>
                    <span>{dailyQuests.feed.claimed ? "1 / 1" : `${dailyQuests.feed.progress} / ${dailyQuests.feed.target}`}</span>
                  </div>
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-violet-400 rounded-full transition-all duration-300"
                      style={{ width: dailyQuests.feed.claimed ? "100%" : `${(dailyQuests.feed.progress / dailyQuests.feed.target) * 100}%` }}
                    />
                  </div>

                  <button
                    onClick={() => handleClaim("daily", "feed")}
                    disabled={dailyQuests.feed.claimed || dailyQuests.feed.progress < dailyQuests.feed.target || claiming["daily-feed"]}
                    className={`w-full py-2 rounded-xl font-bold text-xs transition-all active:scale-[0.98] ${
                      dailyQuests.feed.claimed
                        ? "bg-white/5 text-white/30 cursor-not-allowed border border-white/5"
                        : dailyQuests.feed.progress >= dailyQuests.feed.target
                        ? "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-md shadow-violet-900/20"
                        : "bg-white/5 text-white/40 cursor-not-allowed border border-white/5"
                    }`}
                  >
                    {claiming["daily-feed"] ? "Claiming…" : dailyQuests.feed.claimed ? "Claimed" : "Claim Reward"}
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* SECTION 2: LIMITED TASKS */}
        <div>
          <div className="mb-6 text-center">
            <h2 style={textShadowStyle} className="text-2xl font-bold tracking-wide">Limited Task — One Time Only</h2>
            <p style={textShadowStyle} className="text-white/70 text-xs mt-1 font-mono uppercase">
              These covenants can only be fulfilled once per wallet address.
            </p>
          </div>

          {limitedTasks && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Card 1: Follow Twitter */}
              <div className="relative p-5 rounded-2xl bg-black/25 backdrop-blur-[8px] border border-white/5 shadow-xl flex flex-col justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl relative overflow-hidden shadow-inner flex-shrink-0">
                    <span className="z-10">🐦</span>
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold tracking-wide text-white">Twitter Follow</h3>
                    <p className="text-white/60 text-[11px] mt-0.5 leading-relaxed">
                      Follow @universenga on Twitter to receive the blessing of the Realms.
                    </p>
                    <p className="text-[10px] text-violet-300 font-mono mt-1 font-bold">
                      Reward: +1000 SIG
                    </p>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-white/5">
                  <a
                    href={TWITTER_LINKS.follow}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-1.5 rounded-lg border border-white/15 text-[10px] font-bold text-center block bg-white/5 hover:bg-white/10 hover:text-white transition-all font-mono"
                  >
                    🔗 1. OPEN THE COVENANT LINK
                  </a>
                  
                  <button
                    onClick={() => handleClaim("limited", "follow")}
                    disabled={limitedTasks.follow || claiming["limited-follow"]}
                    className={`w-full py-2 rounded-xl font-bold text-xs transition-all active:scale-[0.98] ${
                      limitedTasks.follow
                        ? "bg-white/5 text-white/30 cursor-not-allowed border border-white/5"
                        : "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-md shadow-violet-900/20"
                    }`}
                  >
                    {claiming["limited-follow"] ? "Claiming…" : limitedTasks.follow ? "Claimed" : "2. COVENANT SEALED — I FOLLOW"}
                  </button>
                </div>
              </div>

              {/* Card 2: Like Tweet */}
              <div className="relative p-5 rounded-2xl bg-black/25 backdrop-blur-[8px] border border-white/5 shadow-xl flex flex-col justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl relative overflow-hidden shadow-inner flex-shrink-0">
                    <span className="z-10">❤️</span>
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold tracking-wide text-white">Like Announcement</h3>
                    <p className="text-white/60 text-[11px] mt-0.5 leading-relaxed">
                      Like the Genesis Crystal announcement tweet to resonate with the community.
                    </p>
                    <p className="text-[10px] text-violet-300 font-mono mt-1 font-bold">
                      Reward: +1000 SIG
                    </p>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-white/5">
                  <a
                    href={TWITTER_LINKS.like}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-1.5 rounded-lg border border-white/15 text-[10px] font-bold text-center block bg-white/5 hover:bg-white/10 hover:text-white transition-all font-mono"
                  >
                    🔗 1. OPEN THE COVENANT LINK
                  </a>
                  
                  <button
                    onClick={() => handleClaim("limited", "like")}
                    disabled={limitedTasks.like || claiming["limited-like"]}
                    className={`w-full py-2 rounded-xl font-bold text-xs transition-all active:scale-[0.98] ${
                      limitedTasks.like
                        ? "bg-white/5 text-white/30 cursor-not-allowed border border-white/5"
                        : "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-md shadow-violet-900/20"
                    }`}
                  >
                    {claiming["limited-like"] ? "Claiming…" : limitedTasks.like ? "Claimed" : "2. RESONANCE SEALED — I LIKED"}
                  </button>
                </div>
              </div>

              {/* Card 3: Retweet */}
              <div className="relative p-5 rounded-2xl bg-black/25 backdrop-blur-[8px] border border-white/5 shadow-xl flex flex-col justify-between gap-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-xl relative overflow-hidden shadow-inner flex-shrink-0">
                    <span className="z-10">🔁</span>
                    <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-transparent pointer-events-none" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-bold tracking-wide text-white">Retweet Covenant</h3>
                    <p className="text-white/60 text-[11px] mt-0.5 leading-relaxed">
                      Retweet the announcement to spread the word of the emerged Siggies.
                    </p>
                    <p className="text-[10px] text-violet-300 font-mono mt-1 font-bold">
                      Reward: +1000 SIG
                    </p>
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-white/5">
                  <a
                    href={TWITTER_LINKS.retweet}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-1.5 rounded-lg border border-white/15 text-[10px] font-bold text-center block bg-white/5 hover:bg-white/10 hover:text-white transition-all font-mono"
                  >
                    🔗 1. OPEN THE COVENANT LINK
                  </a>
                  
                  <button
                    onClick={() => handleClaim("limited", "retweet")}
                    disabled={limitedTasks.retweet || claiming["limited-retweet"]}
                    className={`w-full py-2 rounded-xl font-bold text-xs transition-all active:scale-[0.98] ${
                      limitedTasks.retweet
                        ? "bg-white/5 text-white/30 cursor-not-allowed border border-white/5"
                        : "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-md shadow-violet-900/20"
                    }`}
                  >
                    {claiming["limited-retweet"] ? "Claiming…" : limitedTasks.retweet ? "Claimed" : "2. ECHO SEALED — I RETWEETED"}
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>

      </div>

      {/* ── BOTTOM HUD (Matching style of Dashboard & Shop) ── */}
      <footer className="w-full z-30 px-6 pb-6 pt-2 pointer-events-auto">
        <div className="max-w-4xl mx-auto flex items-center justify-between bg-black/35 backdrop-blur-md border border-white/5 rounded-full px-6 py-3 shadow-lg shadow-black/25">
          <div className="text-[10px] text-white/40 font-mono tracking-wider">
            Connected Wallet: {wallet.slice(0, 6)}…{wallet.slice(-4)}
          </div>
          <div className="hidden md:block text-[11px] text-white/35 font-mono tracking-widest uppercase">
            Ritual Network Testnet
          </div>
          <div className="text-[10px] text-white/40 font-mono tracking-wider">
            Quest Codex Vault
          </div>
        </div>
      </footer>
    </main>
  );
}
