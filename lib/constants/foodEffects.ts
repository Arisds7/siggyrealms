export type FoodKey = "berry" | "meat" | "shell" | "feather" | "crystal" | "mist";

export interface FoodDefinition {
  key: FoodKey;
  name: string;
  effect: Partial<{
    hp: number;
    atk: number;
    def: number;
    spd: number;
    crit: number; // persen
    dodge: number; // persen
  }>;
  satietyCost: number; // pengurangan satiety per feed
}

export const FOODS: Record<FoodKey, FoodDefinition> = {
  berry: { key: "berry", name: "Berry", effect: { hp: 5 }, satietyCost: 10 },
  meat: { key: "meat", name: "Meat", effect: { atk: 1 }, satietyCost: 10 },
  shell: { key: "shell", name: "Shell", effect: { def: 1 }, satietyCost: 10 },
  feather: { key: "feather", name: "Feather", effect: { spd: 1 }, satietyCost: 10 },
  crystal: { key: "crystal", name: "Crystal", effect: { crit: 0.5 }, satietyCost: 10 },
  mist: { key: "mist", name: "Mist", effect: { dodge: 0.5 }, satietyCost: 10 },
};

export const MAX_SATIETY = 100;
export const SATIETY_REGEN_PER_HOUR = 10;
