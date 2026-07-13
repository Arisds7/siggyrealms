import type { Element } from "@/lib/constants/monsterBaseStats";
import { getElementMultiplier } from "@/lib/game-logic/elementMatchup";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CombatantStats {
  name: string;
  element: Element;
  hp: number;
  atk: number;
  def: number;
  spd: number;
  crit: number;  // percentage, e.g. 15 = 15%
  dodge: number; // percentage, e.g. 10 = 10%
}

export interface TurnLog {
  turn: number;
  attacker: "player" | "opponent";
  dodged: boolean;
  crit: boolean;
  damage: number;
  playerHpRemaining: number;
  opponentHpRemaining: number;
}

export interface BattleResult {
  winner: "player" | "opponent";
  turns: TurnLog[];
  totalTurns: number;
}

// ─── Cap Constants ────────────────────────────────────────────────────────────
const MAX_DODGE_PCT = 40;
const MAX_CRIT_PCT  = 50;
const MAX_TURNS     = 50; // safety cap to prevent infinite loops

// ─── Battle Formula ───────────────────────────────────────────────────────────

/**
 * Runs a full async-AI battle between the player's monster and a generated
 * opponent. Pure function — no database access, no side effects.
 * Uses Math.random() for dodge/crit checks; results will naturally vary.
 */
export function runBattle(
  player: CombatantStats,
  opponent: CombatantStats
): BattleResult {
  let playerHp   = player.hp;
  let opponentHp = opponent.hp;
  const turns: TurnLog[] = [];

  // Turn order: higher SPD goes first. Ties broken in player's favor.
  const playerFirst = player.spd >= opponent.spd;

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    // Attacker sequence: player first or opponent first
    const sequence: Array<"player" | "opponent"> = playerFirst
      ? ["player", "opponent"]
      : ["opponent", "player"];

    for (const attacker of sequence) {
      if (playerHp <= 0 || opponentHp <= 0) break;

      const isPlayer   = attacker === "player";
      const atk        = isPlayer ? player   : opponent;
      const def        = isPlayer ? opponent : player;
      const elemMult   = getElementMultiplier(atk.element, def.element);

      // Dodge check — cap at MAX_DODGE_PCT
      const effectiveDodge = Math.min(def.dodge, MAX_DODGE_PCT);
      const dodged = Math.random() * 100 < effectiveDodge;

      let damage = 0;
      let crit   = false;

      if (!dodged) {
        // Crit check — cap at MAX_CRIT_PCT
        const effectiveCrit = Math.min(atk.crit, MAX_CRIT_PCT);
        crit = Math.random() * 100 < effectiveCrit;
        const critMult = crit ? 1.5 : 1.0;

        // Damage formula: max(1, ATK × elemMult × critMult − DEF × 0.5)
        damage = Math.max(1, Math.floor(atk.atk * elemMult * critMult - def.def * 0.5));
      }

      if (isPlayer) {
        opponentHp -= damage;
      } else {
        playerHp -= damage;
      }

      turns.push({
        turn,
        attacker,
        dodged,
        crit,
        damage,
        playerHpRemaining:   Math.max(0, playerHp),
        opponentHpRemaining: Math.max(0, opponentHp),
      });

      if (playerHp <= 0 || opponentHp <= 0) break;
    }

    if (playerHp <= 0 || opponentHp <= 0) break;
  }

  // If MAX_TURNS reached with both alive, whoever has more HP remaining wins.
  const winner: "player" | "opponent" =
    playerHp > 0 && opponentHp <= 0
      ? "player"
      : playerHp <= 0 && opponentHp > 0
      ? "opponent"
      : playerHp >= opponentHp
      ? "player"  // player wins ties
      : "opponent";

  return { winner, turns, totalTurns: turns.length };
}
