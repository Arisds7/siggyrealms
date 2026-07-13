import type { Element } from "@/lib/constants/monsterBaseStats";

// Fire > Nature > Dark > Lightning > Water > Fire (siklus di GDD)
const STRONG_AGAINST: Record<Element, Element> = {
  fire: "nature",
  water: "fire",
  lightning: "water",
  dark: "lightning",
  nature: "dark",
};

export const STRONG_MULTIPLIER = 1.15; // +15% damage
export const WEAK_MULTIPLIER = 0.85; // -15% damage
export const NEUTRAL_MULTIPLIER = 1.0;

// Pure function — gampang di-unit test tanpa database.
export function getElementMultiplier(attacker: Element, defender: Element): number {
  if (STRONG_AGAINST[attacker] === defender) return STRONG_MULTIPLIER;
  if (STRONG_AGAINST[defender] === attacker) return WEAK_MULTIPLIER;
  return NEUTRAL_MULTIPLIER;
}
