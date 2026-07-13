export type EvolutionStage =
  | "initiate"
  | "bitty"
  | "ritty"
  | "ritualist"
  | "radiant_ritualist";

export interface StageDefinition {
  stage: EvolutionStage;
  minLevel: number;
  maxLevel: number;
  evolveCostSig: number;   // biaya SIG untuk evolve KE stage ini (0 untuk initiate)
  evolveRewardSig: number; // reward SIG saat evolve KE stage ini
  expMultiplier: number;   // EXP multiplier untuk naik level di range ini — menempel ke POSISI (index), bukan nama stage
}

// CATATAN URUTAN (GDD update 2026-07-11):
// Urutan stage yang BENAR: Initiate → Bitty → Ritty → Ritualist → Radiant Ritualist.
// expMultiplier menempel ke POSISI/INDEX array ini, bukan ke nama stage —
// sehingga kalau urutan stage berubah lagi di masa depan, cukup update di sini
// dan expCalculator.ts otomatis mengikuti tanpa perlu disentuh.
export const EVOLUTION_STAGES: StageDefinition[] = [
  // Index 0 — Initiate
  { stage: "initiate",           minLevel: 1,   maxLevel: 14,  evolveCostSig: 0,    evolveRewardSig: 0,    expMultiplier: 1.0 },
  // Index 1 — Bitty (level 15-24, evolve pertama)
  { stage: "bitty",              minLevel: 15,  maxLevel: 24,  evolveCostSig: 300,  evolveRewardSig: 500,  expMultiplier: 1.75 },
  // Index 2 — Ritty (level 25-49, evolve kedua)
  { stage: "ritty",              minLevel: 25,  maxLevel: 49,  evolveCostSig: 600,  evolveRewardSig: 1000, expMultiplier: 2.5 },
  // Index 3 — Ritualist
  { stage: "ritualist",          minLevel: 50,  maxLevel: 99,  evolveCostSig: 900,  evolveRewardSig: 1500, expMultiplier: 4.0 },
  // Index 4 — Radiant Ritualist (max stage)
  { stage: "radiant_ritualist",  minLevel: 100, maxLevel: 200, evolveCostSig: 1200, evolveRewardSig: 2000, expMultiplier: 6.5 },
];

export const EVOLUTION_STAT_MULTIPLIER = 1.5; // +50% base stat tiap evolve

export function getStageByLevel(level: number): StageDefinition {
  return (
    EVOLUTION_STAGES.find((s) => level >= s.minLevel && level <= s.maxLevel) ??
    EVOLUTION_STAGES[0]
  );
}

// Cek apakah monster sudah eligible evolve ke stage berikutnya
// (level cukup — pengecekan saldo SIG dilakukan terpisah di API route,
// karena butuh akses database).
export function canEvolveToNextStage(
  currentStage: EvolutionStage,
  level: number
): StageDefinition | null {
  const currentIndex = EVOLUTION_STAGES.findIndex((s) => s.stage === currentStage);
  const nextStage = EVOLUTION_STAGES[currentIndex + 1];
  if (!nextStage) return null;
  return level >= nextStage.minLevel ? nextStage : null;
}
