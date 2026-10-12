// Deterministic primitives of contract/game-rules.md section 1. Pure integer
// arithmetic: no clock, no Math.random, no locale collation.
const textEncoder = new TextEncoder();

export function fnv1a32(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of textEncoder.encode(text))
    hash = Math.imul(hash ^ byte, 0x01000193);
  return hash >>> 0;
}
export function deriveSeed(seed: number, salt: string): number {
  return fnv1a32(`${seed}:${salt}`);
}
export interface RNG {
  next(): number;
}
export function mulberry32(seed: number): RNG {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    },
  };
}
// Fisher-Yates from the end.
export function shuffle<T>(items: readonly T[], source: RNG | number): T[] {
  const rng = typeof source === "number" ? mulberry32(source) : source;
  const result = [...items];
  for (let i = result.length - 1; i >= 1; i--) {
    const j = rng.next() % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
// Code-point order, never UTF-16 units: -1, 0 or 1.
export function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const length = Math.min(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const x = left[i].codePointAt(0) as number;
    const y = right[i].codePointAt(0) as number;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}
const uniqueSorted = (ids: readonly string[]): string[] =>
  [...new Set(ids)].sort(compareCodePoints);

export function drawOrder(cardIds: readonly string[], seed: number): string[] {
  return shuffle(uniqueSorted(cardIds), mulberry32(deriveSeed(seed, "draw")));
}
// Higher or Lower with closer (section 1.5): candidates are the unused cards in
// drawOrder order; the window narrows as more cards are revealed.
export function closerPick(
  candidates: readonly { id: string; year: number }[],
  referenceYear: number,
  revealed: number,
): string | undefined {
  const span = Math.max(3, 20 - 2 * revealed);
  const gap = (card: { year: number }) => Math.abs(card.year - referenceYear);
  const inWindow = candidates.find((card) => gap(card) >= 1 && gap(card) <= span);
  if (inWindow) return inWindow.id;
  let nearest: { id: string; year: number } | undefined;
  for (const card of candidates)
    if (gap(card) > 0 && (nearest === undefined || gap(card) < gap(nearest))) nearest = card;
  return (nearest ?? candidates[0])?.id;
}
export function dailySelection(
  cardIds: readonly string[],
  date: string,
  deckId: string,
): string[] {
  const order = shuffle(
    uniqueSorted(cardIds),
    mulberry32(fnv1a32(date + deckId)),
  );
  return order.slice(0, Math.min(5, order.length));
}

export type AnchorKind = "beginning" | "middle" | "random" | "custom";
export function pickAnchors(
  cards: readonly { id: string; year: number }[],
  kind: AnchorKind,
  seed: number,
  count: number,
  year?: number,
): string[] {
  if (!Number.isInteger(count) || count < 0)
    throw new Error("count must be a non-negative integer.");
  if (kind === "custom" && year === undefined)
    throw new Error("A custom anchor needs a year.");
  const rng = mulberry32(deriveSeed(seed, "anchor"));
  const remaining = [...cards].sort(
    (a, b) => a.year - b.year || compareCodePoints(a.id, b.id),
  );
  const chosen: string[] = [];
  for (let pick = 0; pick < count; pick++) {
    const n = remaining.length;
    if (n === 0) throw new Error("Not enough cards to pick anchors.");
    const k = Math.max(1, Math.floor((n + 9) / 10));
    let pool = remaining;
    if (kind === "beginning") pool = remaining.slice(0, k);
    else if (kind === "middle") {
      const m = Math.floor((n - 1) / 2);
      const start = Math.min(Math.max(m - Math.floor((k - 1) / 2), 0), n - k);
      pool = remaining.slice(start, start + k);
    } else if (kind === "custom") {
      const nearest = Math.min(
        ...remaining.map((card) => Math.abs(card.year - (year as number))),
      );
      pool = remaining.filter(
        (card) => Math.abs(card.year - (year as number)) === nearest,
      );
    }
    const picked = pool[rng.next() % pool.length];
    chosen.push(picked.id);
    remaining.splice(remaining.indexOf(picked), 1);
  }
  return chosen;
}
