import data from "../../../../contract/eras.json";

// Era boundaries live only in contract/eras.json (game-rules.md section 2).
export interface EraBounds {
  id: string;
  name: string;
  from: number | null;
  to: number | null;
}
export const ERA_BOUNDS = data.eras as EraBounds[];
export const ERA_IDS: readonly string[] = ERA_BOUNDS.map((era) => era.id);

export function eraOf(year: number): string {
  const found = ERA_BOUNDS.find(
    (era) =>
      (era.from === null || year >= era.from) &&
      (era.to === null || year <= era.to),
  );
  if (!found) throw new Error(`No era for year ${year}.`);
  return found.id;
}
export function eraIndex(id: string): number {
  const index = ERA_IDS.indexOf(id);
  if (index < 0) throw new Error(`Unknown era ID: ${id}.`);
  return index;
}
export function eraName(id: string): string {
  return ERA_BOUNDS[eraIndex(id)].name;
}
export function isAdjacent(a: string, b: string): boolean {
  return Math.abs(eraIndex(a) - eraIndex(b)) === 1;
}
