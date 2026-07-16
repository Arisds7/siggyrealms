"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import LoadingScreen from "@/components/ui/LoadingScreen";
import { getStageByLevel } from "@/lib/constants/evolutionThresholds";
import { useUserStats } from "@/lib/context/UserStatsContext";
import { useBackgroundMusic } from "@/lib/hooks/useBackgroundMusic";

export const dynamic = "force-dynamic";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonsterStats {
  hp: number; atk: number; def: number;
  spd: number; crit: number; dodge: number;
}
interface FoodBonus {
  hp_bonus: number; atk_bonus: number; def_bonus: number;
  spd_bonus: number; crit_bonus: number; dodge_bonus: number;
}
interface Species { name: string; element: string; role: string; }
interface ArenaMonster {
  id: string; level: number; evolution_stage: string;
  species_key: string; nickname: string | null;
  species: Species; monster_stats: MonsterStats; monster_food_bonus: FoodBonus;
}
interface RecentBattle {
  id: string; result: "win" | "lose"; sig_reward: number;
  opponent_snapshot: { name: string; level: number; element: string };
  created_at: string;
}
interface TurnLog {
  turn: number; attacker: "player" | "opponent";
  dodged: boolean; crit: boolean; damage: number;
  playerHpRemaining: number; opponentHpRemaining: number;
}
interface BattleResultData {
  result: "win" | "lose"; sig_reward: number; tickets_remaining: number;
  total_turns: number; battle_log: TurnLog[];
  player: { element: string; hp: number };
  opponent: { name: string; level: number; element: string; hp: number };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ELEMENT_BADGE: Record<string, string> = {
  fire:      "text-[#e4572e]",
  water:     "text-[#2e86e4]",
  nature:    "text-[#3fae5c]",
  lightning: "text-[#f2c94c]",
  dark:      "text-[#a87be0]",
};

const ELEMENT_EMOJI: Record<string, string> = {
  fire: "🔥", water: "💧", nature: "🌿", lightning: "⚡", dark: "🌑",
};

function statTotal(m: ArenaMonster, stat: keyof MonsterStats): number {
  const b = stat + "_bonus" as keyof FoodBonus;
  return m.monster_stats[stat] + (m.monster_food_bonus[b as keyof FoodBonus] as number);
}

const textShadow = { textShadow: "0 1px 4px rgba(0,0,0,0.8)" };

// ─── Component ────────────────────────────────────────────────────────────────

export default function ArenaPage() {
  const router = useRouter();
  const { sigBalance, arenaTickets: ticketsRemaining, refresh: refreshStats } = useUserStats();

  // ── Background Music ──────────────────────────────────────────────────────
  const { isMuted, toggleMute } = useBackgroundMusic({
    src: "/audio/arena.mp3",
    volume: 0.25,
    loop: true,
  });

  const [monsters,          setMonsters]          = useState<ArenaMonster[]>([]);
  const [selectedIdx,       setSelectedIdx]       = useState(0);
  const [recentBattles,     setRecentBattles]     = useState<RecentBattle[]>([]);

  const [isLoading,   setIsLoading]   = useState(true);
  const [battling,    setBattling]    = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [toast,       setToast]       = useState<string | null>(null);

  // ── Battle Animation System State ──
  const [activeBattle,     setActiveBattle]     = useState<BattleResultData | null>(null);
  const [isBattleActive,   setIsBattleActive]   = useState(false);
  const [animTurn,         setAnimTurn]         = useState(-1); // -1 = Intro/VS Screen

  // Dynamic HP/combat states
  const [playerHp,         setPlayerHp]         = useState(100);
  const [opponentHp,       setOpponentHp]       = useState(100);
  const [playerMaxHp,      setPlayerMaxHp]      = useState(100);
  const [opponentMaxHp,    setOpponentMaxHp]    = useState(100);

  // Animation visual triggers
  const [playerDmgFloat,   setPlayerDmgFloat]   = useState<string | null>(null);
  const [opponentDmgFloat, setOpponentDmgFloat] = useState<string | null>(null);
  const [playerFloatKey,   setPlayerFloatKey]   = useState(0);
  const [opponentFloatKey, setOpponentFloatKey] = useState(0);
  const [playerShake,      setPlayerShake]      = useState(false);
  const [opponentShake,    setOpponentShake]    = useState(false);
  const [actionText,       setActionText]       = useState("Ritual Arena Dimulai...");

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Store wallet in a ref so setTimeout callbacks always have access ──────
  const walletRef = useRef<string | null>(null);

  // ── Fetch Arena Data (initial load — manages loading/error state) ──────────
  const loadArenaData = useCallback(async (wallet: string) => {
    try {
      const res = await fetch(`/api/arena/info?t=${Date.now()}`);
      if (!res.ok) throw new Error("The Arena portal failed to open. The Realms are unstable.");
      const data = await res.json();
      setMonsters(data.monsters ?? []);
      setRecentBattles(data.recent_battles ?? []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Silent refresh (post-battle) — updates state without touching loading/error ─
  const refreshArena = useCallback(async () => {
    const wallet = walletRef.current;
    if (!wallet) return;
    try {
      const res = await fetch(`/api/arena/info?t=${Date.now()}`);
      if (!res.ok) return; // silently ignore errors during refresh
      const data = await res.json();
      setMonsters(data.monsters ?? []);
      setRecentBattles(data.recent_battles ?? []);
      await refreshStats();
    } catch {
      // silently ignore — this is a background refresh
    }
  }, [refreshStats]);

  useEffect(() => {
    const wallet = localStorage.getItem("siggy_wallet_address");
    if (!wallet) { router.replace("/login"); return; }
    walletRef.current = wallet;
    loadArenaData(wallet);
    refreshStats();
  }, [router, loadArenaData, refreshStats]);

  // ── Polling: refresh lobby data every 8s when NOT in battle ─────────────
  useEffect(() => {
    if (isBattleActive) return; // skip during battle
    const interval = setInterval(() => refreshArena(), 8000);
    return () => clearInterval(interval);
  }, [isBattleActive, refreshArena]);

  // ── Battle Handler ──────────────────────────────────────────────────────────
  const handleBattle = async () => {
    const wallet = localStorage.getItem("siggy_wallet_address");
    if (!wallet || battling) return;

    // Use eligibleMonsters (level >= 15) for the selected index
    const eligibleList = monsters.filter(m => m.level >= 15);
    const monster = eligibleList[selectedIdx];
    if (!monster) return;

    if (monster.level < 15) {
      showToast("Your Siggy must reach Level 15 (Bitty) before entering the Arena.");
      return;
    }

    setBattling(true);
    try {
      const res = await fetch("/api/arena/battle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monsterId: monster.id }),
      });
      const data = await res.json();

      if (!res.ok) {
        showToast(data.error ?? "The Arena ritual was disrupted. Try again.");
        return;
      }

      // Initialize Battle Animation System
      setPlayerMaxHp(data.player.hp);
      setPlayerHp(data.player.hp);
      setOpponentMaxHp(data.opponent.hp);
      setOpponentHp(data.opponent.hp);
      setAnimTurn(-1);
      setActionText("Channeling through the Realms... The clash is near.");
      setActiveBattle(data);
      setIsBattleActive(true);

      // Immediately refresh stats from context (updates balance and ticket counts)
      refreshStats();
      // Refresh all data from DB after short delay (give DB time to commit)
      setTimeout(() => refreshArena(), 600);
      // Second refresh after animations are done
      setTimeout(() => refreshArena(), 4500);
    } catch {
      showToast("The Arena channel has collapsed. Retry the ritual.");
    } finally {
      setBattling(false);
    }
  };

  // ── Battle Turn Animation Controller ──
  useEffect(() => {
    if (!isBattleActive || !activeBattle) return;

    if (animTurn === -1) {
      // Intro delay before starting turns
      const timer = setTimeout(() => {
        setAnimTurn(0);
      }, 2200);
      return () => clearTimeout(timer);
    }

    if (animTurn >= 0 && animTurn < activeBattle.battle_log.length) {
      const timer = setTimeout(() => {
        const turn = activeBattle.battle_log[animTurn];
        const isPlayer = turn.attacker === "player";
        const speciesName = selectedMonster ? selectedMonster.species.name : "Siggy";
        const oppName = activeBattle.opponent.name;

        // Construct descriptive action text matching Siggy Realms lore
        let logMsg = "";
        if (turn.dodged) {
          logMsg = `${isPlayer ? speciesName : oppName} strikes — but the blow fades into shadow!`;
        } else {
          logMsg = `${isPlayer ? speciesName : oppName} unleashes a devastating blow! ${turn.damage} damage inflicted.${turn.crit ? " ✦ Critical Strike!" : ""}`;
        }
        setActionText(logMsg);

        // Apply HP reduction
        setPlayerHp(turn.playerHpRemaining);
        setOpponentHp(turn.opponentHpRemaining);

        // Trigger floating damage text and hit animations
        if (isPlayer) {
          // Player attacks opponent
          if (turn.dodged) {
            setOpponentDmgFloat("MISS");
          } else {
            setOpponentDmgFloat(turn.crit ? `✦ CRIT -${turn.damage} ✦` : `-${turn.damage}`);
            setOpponentShake(true);
            setTimeout(() => setOpponentShake(false), 500);
          }
          setOpponentFloatKey(prev => prev + 1);
        } else {
          // Opponent attacks player
          if (turn.dodged) {
            setPlayerDmgFloat("MISS");
          } else {
            setPlayerDmgFloat(turn.crit ? `✦ CRIT -${turn.damage} ✦` : `-${turn.damage}`);
            setPlayerShake(true);
            setTimeout(() => setPlayerShake(false), 500);
          }
          setPlayerFloatKey(prev => prev + 1);
        }

        // Proceed to next turn
        setAnimTurn(prev => prev + 1);
      }, 1400);

      return () => clearTimeout(timer);
    }

    if (animTurn === activeBattle.battle_log.length) {
      // All turns finished
      setActionText(activeBattle.result === "win" ? "Absolute dominion! The Realms have blessed your entity." : "The entity fell. Rise again when the ritual resets.");
    }
  }, [isBattleActive, animTurn, activeBattle]);

  // ─── Render Guards ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <LoadingScreen tips={[
        "Tearing open the Arena rift…",
        "Summoning a Shadow Entity from the void…",
        "Forging the sacred battleground…",
      ]} />
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#0d0b14] p-6">
        <div className="text-center space-y-4">
          <p className="text-red-400 font-mono">{error}</p>
          <button onClick={() => router.push("/dashboard")}
            className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors">
            Return to Codex
          </button>
        </div>
      </main>
    );
  }

  const eligibleMonsters = monsters.filter(m => m.level >= 15);
  const selectedMonster = eligibleMonsters[selectedIdx] ?? null;
  const canBattle = !!selectedMonster && ticketsRemaining > 0 && !battling;

  // Render logic for battle screen
  if (isBattleActive && activeBattle) {
    const oppSpeciesKey = activeBattle.opponent.name.replace("Shadow ", "").toLowerCase();
    const oppEvolutionStage = getStageByLevel(activeBattle.opponent.level).stage;

    const playerImgPath = selectedMonster
      ? `/monsters/${selectedMonster.species_key}/${selectedMonster.evolution_stage}.png`
      : null;
    const opponentImgPath = `/monsters/${oppSpeciesKey}/${oppEvolutionStage}.png`;

    const isFinished = animTurn === activeBattle.battle_log.length;

    return (
      <main
        className="relative min-h-screen w-full text-white overflow-hidden flex flex-col items-center justify-between"
        style={{ isolation: 'isolate', background: '#0a0010' }}
      >
        {/* Fenced custom keyframe animations */}
        <style>{`
          @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
          }
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            20%, 60% { transform: translateX(-8px); }
            40%, 80% { transform: translateX(8px); }
          }
          @keyframes float-up {
            0% { transform: translateY(20px); opacity: 0; }
            15% { transform: translateY(0); opacity: 1; }
            85% { transform: translateY(-25px); opacity: 1; }
            100% { transform: translateY(-35px); opacity: 0; }
          }
          .animate-monster-float { animation: float 3.5s ease-in-out infinite; }
          .animate-monster-shake { animation: shake 0.4s ease-in-out; }
          .animate-combat-float { animation: float-up 1.2s ease-out forwards; }
        `}</style>

        {/* Background — sits behind everything via absolute positioning */}
        <div className="absolute inset-0" style={{ zIndex: 0 }}>
          <Image
            src="/arena/arena.png"
            alt="Arena Background"
            fill
            priority
            className="object-cover object-center pointer-events-none brightness-[0.7] contrast-[1.1]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-black/30 pointer-events-none" />
        </div>

        {/* Top Header info */}
        <header className="relative z-[2] w-full max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="text-left font-mono">
            <span className="text-white/40 text-[10px] uppercase tracking-wider block">Realms Arena</span>
            <span className="text-violet-300 text-xs font-semibold">
              Turn {Math.max(1, Math.min(animTurn + 1, activeBattle.battle_log.length))} / {activeBattle.total_turns}
            </span>
          </div>
          <div className="bg-black/40 border border-white/10 backdrop-blur-md rounded-full px-5 py-1.5 text-xs font-mono tracking-widest text-white/80">
            {activeBattle.opponent.name} (Lv.{activeBattle.opponent.level})
          </div>
        </header>

        {/* Core Battle Area */}
        <div className="relative z-[2] w-full max-w-5xl flex-1 flex items-center justify-center relative px-6">
          
          {/* Dynamic Action log banner */}
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 border border-white/5 backdrop-blur-md rounded-xl px-6 py-2.5 text-center text-xs font-mono text-violet-200 max-w-lg shadow-xl shadow-black/40 z-20 transition-all duration-300">
            {actionText}
          </div>

          {/* Grid mapping both combatants */}
          <div className="grid grid-cols-2 w-full gap-8 relative items-center">
            
            {/* Player Side (Left) */}
            <div className="flex flex-col items-center justify-end relative select-none">
              
              {/* HP Bar */}
              <div className="w-full max-w-[200px] mb-4 space-y-1 relative">
                <div className="flex justify-between text-[10px] font-mono font-bold tracking-wider text-blue-300">
                  <span>{selectedMonster?.nickname ?? selectedMonster?.species.name}</span>
                  <span>{playerHp} / {playerMaxHp}</span>
                </div>
                <div className="w-full h-2.5 bg-black/50 border border-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(0, (playerHp / playerMaxHp) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Pedestal */}
              <div className="absolute bottom-[-10px] w-48 h-10 bg-blue-500/10 border-t border-blue-400/20 rounded-full blur-[2px] -z-10 transform scale-x-150" />

              {/* Monster Sprite */}
              {playerImgPath && (
                <div className={`relative w-48 h-48 animate-monster-float ${playerShake ? "animate-monster-shake" : ""}`}>
                  <Image
                    src={playerImgPath}
                    alt="Your Monster"
                    fill
                    priority
                    className="object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.9)]"
                  />
                </div>
              )}

              {/* Floating Text Player */}
              {playerDmgFloat && (
                <div
                  key={`${playerFloatKey}`}
                  className={`absolute -top-12 text-center text-sm font-mono font-bold tracking-widest pointer-events-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] z-20 animate-combat-float ${
                    playerDmgFloat.includes("CRIT")
                      ? "text-orange-400 text-lg scale-110"
                      : playerDmgFloat === "MISS"
                      ? "text-white/40"
                      : "text-red-400"
                  }`}
                >
                  {playerDmgFloat}
                </div>
              )}
            </div>

            {/* Opponent Side (Right) */}
            <div className="flex flex-col items-center justify-end relative select-none">
              
              {/* HP Bar */}
              <div className="w-full max-w-[200px] mb-4 space-y-1 relative">
                <div className="flex justify-between text-[10px] font-mono font-bold tracking-wider text-red-400">
                  <span>{activeBattle.opponent.name}</span>
                  <span>{opponentHp} / {opponentMaxHp}</span>
                </div>
                <div className="w-full h-2.5 bg-black/50 border border-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-red-600 to-rose-400 transition-all duration-300 ease-out"
                    style={{ width: `${Math.max(0, (opponentHp / opponentMaxHp) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Pedestal */}
              <div className="absolute bottom-[-10px] w-48 h-10 bg-red-500/10 border-t border-red-400/20 rounded-full blur-[2px] -z-10 transform scale-x-150" />

              {/* Monster Sprite — scaleX(-1) so it faces left toward the player */}
              <div className={`relative w-48 h-48 animate-monster-float ${opponentShake ? "animate-monster-shake" : ""}`}>
                <Image
                  src={opponentImgPath}
                  alt="Opponent Monster"
                  fill
                  priority
                  className="object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.9)]"
                  style={{ transform: 'scaleX(-1)' }}
                />
              </div>

              {/* Floating Text Opponent */}
              {opponentDmgFloat && (
                <div
                  key={`${opponentFloatKey}`}
                  className={`absolute -top-12 text-center text-sm font-mono font-bold tracking-widest pointer-events-none drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] z-20 animate-combat-float ${
                    opponentDmgFloat.includes("CRIT")
                      ? "text-orange-400 text-lg scale-110"
                      : opponentDmgFloat === "MISS"
                      ? "text-white/40"
                      : "text-red-400"
                  }`}
                >
                  {opponentDmgFloat}
                </div>
              )}
            </div>

          </div>
        </div>

        {/* Bottom banner for victory/defeat */}
        <footer className="relative z-[2] w-full max-w-6xl px-6 py-6 flex items-center justify-center">
          {isFinished && (
            <div className="w-full max-w-md bg-[#0d0b14]/90 border border-violet-500/30 rounded-2xl p-6 shadow-2xl text-center space-y-4 animate-pulse">
              <h3 className={`text-2xl font-black tracking-widest ${activeBattle.result === "win" ? "text-emerald-300" : "text-red-400"}`}>
                {activeBattle.result === "win" ? "🏆 BATTLE WON 🏆" : "💀 BATTLE LOST 💀"}
              </h3>
              <p className="text-white/60 text-xs font-mono">
                {activeBattle.result === "win"
                  ? "Your entity has dominated the battlefield!"
                  : "Your entity was not strong enough to claim victory this time."}
              </p>
              <div className="bg-white/5 border border-white/10 rounded-xl px-5 py-2.5 flex justify-between items-center text-xs font-mono">
                <span className="text-white/40">Reward</span>
                <span className="text-amber-300 font-bold">+{activeBattle.sig_reward} SIG</span>
              </div>
              <button
                onClick={() => {
                  setIsBattleActive(false);
                  setActiveBattle(null);
                  // Refresh data so lobby shows updated SIG, tickets, and Chronicle
                  refreshArena();
                }}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-xs font-bold tracking-widest uppercase transition-all"
              >
                Return to Lobby
              </button>
            </div>
          )}
        </footer>
      </main>
    );
  }

  // ─── Regular Selection Screen JSX ──────────────────────────────────────────
  return (
    <main className="relative min-h-screen w-full text-white overflow-x-hidden flex flex-col">
      {/* Background */}
      <div className="absolute inset-0 -z-20 overflow-hidden">
        <Image src="/arena/arena.png" alt="Arena" fill priority className="object-cover object-center pointer-events-none" />
        <div className="absolute inset-0 bg-black/60 pointer-events-none" />
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full bg-black/85 border border-white/10 backdrop-blur-md text-sm text-violet-300 font-mono shadow-xl">
          {toast}
        </div>
      )}

      {/* Top Bar */}
      <header className="w-full z-40 px-6 py-4 flex items-center justify-between">
        <Link href="/dashboard"
          className="flex items-center gap-2 bg-black/30 hover:bg-black/45 px-4 py-2 rounded-full border border-white/5 backdrop-blur-md transition-all text-white/80 text-xs font-mono">
          ← Back to Codex
        </Link>
        <h1 className="text-xl font-bold tracking-[0.25em] text-white/95 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
          AI ARENA
        </h1>
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
            <span className="text-sm font-bold font-mono text-white/90">{sigBalance}</span>
            <span className="text-[10px] text-white/40">SIG</span>
          </div>
          <div className="flex items-center gap-2 bg-black/30 px-3.5 py-2 rounded-full border border-white/5 backdrop-blur-md shadow-md">
            <span className="text-[11px] font-mono text-white/70">🎟 {ticketsRemaining}/3 Tickets</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-6 py-6 z-20 flex flex-col gap-8">

        {/* Case 1: No monsters at all */}
        {monsters.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center gap-4 py-12">
            <p className="text-5xl opacity-30">⚔️</p>
            <p style={textShadow} className="text-white/70 text-sm">No Siggies have answered your call yet.</p>
            <button onClick={() => router.push("/mint")}
              className="px-6 py-2.5 rounded-full bg-gradient-to-r from-violet-600 to-purple-600 text-white text-xs font-semibold tracking-wider shadow-lg">
              🔮 Awaken Crystal
            </button>
          </div>
        )}

        {/* Case 2: Has monsters but none are level 15+ (Evolved) */}
        {monsters.length > 0 && eligibleMonsters.length === 0 && (
          <div className="max-w-md mx-auto w-full bg-[#0d0b14]/85 border border-yellow-500/20 rounded-2xl p-8 text-center space-y-5 shadow-2xl">
            <p className="text-5xl">🔮</p>
            <h3 className="text-lg font-bold text-yellow-300">Your Entities Are Not Yet Ready</h3>
            <p className="text-white/60 text-xs font-mono leading-relaxed">
              All your entities dwell below Level 15 (Initiate). Train and nourish them in the Codex, then bind them through the Evolution Ritual (minimum Bitty) before they may enter the Arena.
            </p>
            <button onClick={() => router.push("/dashboard")}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-xs font-semibold tracking-wider shadow-lg transition-all">
              Return to Codex & Train Your Entity
            </button>
          </div>
        )}

        {/* Case 3: Has eligible monsters */}
        {eligibleMonsters.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* LEFT: Monster Selector */}
            <div className="lg:col-span-1 flex flex-col gap-4">
              <h2 style={textShadow} className="text-sm font-bold uppercase tracking-widest text-white/80 border-b border-white/10 pb-2">
                Choose Your Entity
              </h2>

              <div className="flex flex-col gap-3 max-h-[420px] overflow-y-auto pr-1">
                {eligibleMonsters.map((m, idx) => {
                  return (
                    <div
                      key={m.id}
                      onClick={() => setSelectedIdx(idx)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        selectedIdx === idx
                          ? "bg-violet-900/30 border-violet-500/50 shadow-lg shadow-violet-900/20"
                          : "bg-black/20 border-white/5 hover:border-white/15"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-white">{m.nickname ?? m.species.name}</p>
                          <p className="text-[10px] text-white/50 font-mono">Lv.{m.level} · {m.evolution_stage.replace(/_/g, " ")}</p>
                        </div>
                        <span className={`text-xs font-bold uppercase ${ELEMENT_BADGE[m.species.element]}`}>
                          {ELEMENT_EMOJI[m.species.element]} {m.species.element}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* CENTER: Combat Preview + Battle Button */}
            <div className="lg:col-span-1 flex flex-col items-center gap-5">
              {selectedMonster && (
                <>
                  <div className="w-full p-5 rounded-2xl bg-black/25 backdrop-blur-[8px] border border-white/5 shadow-xl space-y-4">
                    <h3 style={textShadow} className="text-xs font-bold uppercase tracking-widest text-white/70 border-b border-white/10 pb-2">
                      Combat Stats
                    </h3>
                    <div className="grid grid-cols-2 gap-2.5">
                      {(["hp","atk","def","spd","crit","dodge"] as const).map(stat => (
                        <div key={stat} className="flex justify-between items-center py-1 border-b border-white/5">
                          <span className="text-[10px] text-white/50 uppercase font-mono">{stat}</span>
                          <span className="text-sm font-bold text-white font-mono">
                            {stat === "crit" || stat === "dodge"
                              ? `${statTotal(selectedMonster, stat as keyof MonsterStats)}%`
                              : statTotal(selectedMonster, stat as keyof MonsterStats)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Ticket / eligibility status */}
                  <div className="w-full p-4 rounded-xl bg-black/20 border border-white/5 text-center space-y-1">
                    <p className="text-[11px] font-mono text-white/50">
                      🎟 {ticketsRemaining}/3 Battle Tickets Remaining
                    </p>
                    {ticketsRemaining === 0 && (
                      <p className="text-[10px] text-red-400/80 font-mono">Resets at UTC midnight</p>
                    )}
                  </div>

                  {/* Reward preview */}
                  <div className="w-full flex gap-3 text-center">
                    <div className="flex-1 p-3 rounded-xl bg-emerald-900/20 border border-emerald-500/20">
                      <p className="text-[10px] text-emerald-400 font-mono uppercase">Win</p>
                      <p className="text-base font-bold text-emerald-300 font-mono">+50 SIG</p>
                    </div>
                    <div className="flex-1 p-3 rounded-xl bg-red-900/20 border border-red-500/20">
                      <p className="text-[10px] text-red-400 font-mono uppercase">Lose</p>
                      <p className="text-base font-bold text-red-300 font-mono">+20 SIG</p>
                    </div>
                  </div>

                  {/* Battle Button */}
                  <button
                    onClick={handleBattle}
                    disabled={!canBattle}
                    className={`w-full py-3.5 rounded-2xl font-extrabold text-sm tracking-widest transition-all active:scale-[0.97] shadow-lg ${
                      canBattle
                        ? "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white shadow-violet-900/30 animate-pulse"
                        : "bg-white/5 text-white/30 border border-white/5 cursor-not-allowed"
                    }`}
                  >
                    {battling
                      ? "The crystal is resonating…"
                      : ticketsRemaining <= 0
                      ? "No Tickets — Return Tomorrow"
                      : "⚔️ Enter the Arena"}
                  </button>
                </>
              )}
            </div>

            {/* RIGHT: Recent Battle History */}
            <div className="lg:col-span-1 flex flex-col gap-4">
              <h2 style={textShadow} className="text-sm font-bold uppercase tracking-widest text-white/80 border-b border-white/10 pb-2">
                Chronicle of Battles
              </h2>

              {recentBattles.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-white/40 text-xs font-mono">No battles recorded yet.</p>
                  <p className="text-white/25 text-[10px] font-mono mt-1">Forge your legacy in the Arena.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {recentBattles.map((b) => (
                    <div key={b.id} className={`p-4 rounded-xl border ${b.result === "win" ? "bg-emerald-900/15 border-emerald-500/20" : "bg-red-900/10 border-red-500/15"}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <span className={`text-xs font-bold ${b.result === "win" ? "text-emerald-300" : "text-red-400"}`}>
                            {b.result === "win" ? "🏆 Victory" : "💀 Defeated"}
                          </span>
                          <p className="text-[10px] text-white/40 font-mono mt-0.5">
                            vs {b.opponent_snapshot?.name} (Lv.{b.opponent_snapshot?.level}) {ELEMENT_EMOJI[b.opponent_snapshot?.element] ?? ""}
                          </p>
                        </div>
                        <span className="text-amber-300 font-bold font-mono text-xs">+{b.sig_reward} SIG</span>
                      </div>
                      <p className="text-[9px] text-white/25 font-mono mt-1.5">
                        {new Date(b.created_at).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* Bottom HUD */}
      <footer className="w-full z-30 px-6 pb-6 pt-2">
        <div className="max-w-4xl mx-auto flex items-center justify-between bg-black/35 backdrop-blur-md border border-white/5 rounded-full px-6 py-3 shadow-lg">
          <div className="text-[10px] text-white/35 font-mono">AI Arena — Async Combat</div>
          <div className="hidden md:block text-[11px] text-white/35 font-mono tracking-widest uppercase">Ritual Network Testnet</div>
          <div className="text-[10px] text-white/35 font-mono">3 Tickets/Day</div>
        </div>
      </footer>
    </main>
  );
}
