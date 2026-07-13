export type Element = "fire" | "water" | "nature" | "lightning" | "dark";

export interface BaseStats {
  hp: number;
  atk: number;
  def: number;
  spd: number;
  crit: number; // dalam persen, contoh 5 = 5%
  dodge: number; // dalam persen
}

export interface SpeciesDefinition {
  key: string;
  name: string;
  element: Element;
  role: string;
  baseStats: BaseStats;
}

export const SPECIES: Record<string, SpeciesDefinition> = {
  cindrel: {
    key: "cindrel",
    name: "Cindrel",
    element: "fire",
    role: "Fighter",
    baseStats: { hp: 120, atk: 28, def: 14, spd: 16, crit: 5, dodge: 5 },
  },
  tidera: {
    key: "tidera",
    name: "Tidera",
    element: "water",
    role: "Tank",
    baseStats: { hp: 180, atk: 18, def: 25, spd: 8, crit: 3, dodge: 3 },
  },
  mossel: {
    key: "mossel",
    name: "Mossel",
    element: "nature",
    role: "Balanced / Support",
    baseStats: { hp: 140, atk: 22, def: 18, spd: 12, crit: 5, dodge: 5 },
  },
  voltra: {
    key: "voltra",
    name: "Voltra",
    element: "lightning",
    role: "Assassin",
    baseStats: { hp: 95, atk: 26, def: 10, spd: 30, crit: 8, dodge: 10 },
  },
  umbren: {
    key: "umbren",
    name: "Umbren",
    element: "dark",
    role: "Burst Mage",
    baseStats: { hp: 110, atk: 32, def: 10, spd: 18, crit: 12, dodge: 6 },
  },
};

export const SPECIES_KEYS = Object.keys(SPECIES);

// Dipakai saat hatch egg — random merata di antara 5 spesies.
// Kalau nanti mau ada rarity/weighted gacha, ubah logic di sini saja,
// sehingga tempat lain (API mint) tidak perlu tahu detailnya.
export function rollRandomSpecies(): SpeciesDefinition {
  const key = SPECIES_KEYS[Math.floor(Math.random() * SPECIES_KEYS.length)];
  return SPECIES[key];
}
