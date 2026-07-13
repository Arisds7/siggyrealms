import { getStageByLevel } from "@/lib/constants/evolutionThresholds";

// CATATAN REFACTOR (2026-07-11):
// expMultiplier sebelumnya disimpan di STAGE_MULTIPLIERS Record<string, number>
// yang di-lookup berdasarkan NAMA stage. Ini rawan bug kalau urutan stage berubah
// (seperti yang baru saja terjadi: ritty⇔bitty swap).
//
// Sekarang expMultiplier adalah field langsung di setiap entry EVOLUTION_STAGES
// (lib/constants/evolutionThresholds.ts), sehingga multiplier menempel ke
// POSISI/LEVEL RANGE, bukan nama string. Kalau urutan stage berubah lagi,
// cukup update evolutionThresholds.ts — file ini tidak perlu disentuh.

/**
 * Mendapatkan multiplier EXP berdasarkan level saat ini.
 * Membaca dari field expMultiplier di EVOLUTION_STAGES — positional, bukan by name.
 */
export function getStageMultiplier(level: number): number {
  return getStageByLevel(level).expMultiplier;
}

/**
 * Menghitung EXP yang dibutuhkan untuk naik dari level L ke L+1.
 * Formula: 100 * L * stageMultiplier(L)
 */
export function expRequiredForLevel(level: number): number {
  return 100 * level * getStageMultiplier(level);
}

/**
 * Menghitung level saat ini, sisa EXP di level tersebut, dan target EXP level berikutnya
 * berdasarkan total akumulasi EXP secara iteratif.
 *
 * @param totalExp Total EXP akumulatif monster
 */
export function getLevelFromTotalExp(totalExp: number): {
  level: number;
  expIntoCurrentLevel: number;
  expRequiredForNextLevel: number;
} {
  let level = 1;
  let remainingExp = Math.max(0, totalExp);
  const maxLevel = 200;

  while (level < maxLevel) {
    const req = expRequiredForLevel(level);
    if (remainingExp >= req) {
      remainingExp -= req;
      level++;
    } else {
      break;
    }
  }

  const expIntoCurrentLevel = remainingExp;
  const expRequiredForNextLevel = level < maxLevel ? expRequiredForLevel(level) : 0;

  return {
    level,
    expIntoCurrentLevel,
    expRequiredForNextLevel,
  };
}

/**
 * Wrapper function lama agar kompatibel dengan pemanggilan di bagian kode lain
 */
export function expToLevel(totalExp: number): number {
  return getLevelFromTotalExp(totalExp).level;
}

/**
 * Mengembalikan progress EXP dalam level saat ini (untuk rendering progress bar)
 */
export function expProgressInLevel(totalExp: number): {
  current: number;
  needed: number;
  percentage: number;
} {
  const { expIntoCurrentLevel, expRequiredForNextLevel } = getLevelFromTotalExp(totalExp);
  const needed = expRequiredForNextLevel === 0 ? 100 : expRequiredForNextLevel; // default to 100 if capped
  const percentage = expRequiredForNextLevel === 0 ? 100 : Math.min(100, Math.round((expIntoCurrentLevel / needed) * 100));

  return {
    current: expIntoCurrentLevel,
    needed: expRequiredForNextLevel,
    percentage,
  };
}
