import { eraName, eraOf, isAdjacent } from "./eras";
import { compareCodePoints, deriveSeed, mulberry32, shuffle } from "./random";

// Scoring primitives of contract/game-rules.md section 3. Inputs outside a
// function's domain throw; no substitute value is returned (section 1.1).
export function placementCorrect(
  years: readonly number[],
  slot: number,
  year: number,
): boolean {
  if (!Number.isInteger(slot) || slot < 0 || slot > years.length)
    throw new Error(`Slot ${slot} is outside 0 to ${years.length}.`);
  return (
    (slot === 0 || years[slot - 1] <= year) &&
    (slot === years.length || year <= years[slot])
  );
}
export function insertionIndex(years: readonly number[], year: number): number {
  return years.filter((value) => value <= year).length;
}
export const distance = (a: number, b: number): number => Math.abs(a - b);
export function bullseyePoints(guess: number, answer: number): number {
  const d = distance(guess, answer);
  if (d === 0) return 10;
  if (d === 1) return 7;
  if (d <= 3) return 5;
  if (d <= 5) return 3;
  return d <= 10 ? 1 : 0;
}
export function eraSortPoints(
  guessEra: string,
  answerYear: number,
  kids: boolean,
): number {
  const answer = eraOf(answerYear);
  if (guessEra === answer) return 3;
  return isAdjacent(guessEra, answer) ? (kids ? 3 : 1) : 0;
}
const LADDER_POINTS = [10, 8, 6, 4, 2];
export function ladderPoints(
  stepIndex: number,
  titleOK: boolean,
  artistOK: boolean,
): number {
  const points = LADDER_POINTS[stepIndex];
  if (points === undefined) throw new Error(`Unknown step: ${stepIndex}.`);
  if (titleOK && artistOK) return points;
  return titleOK || artistOK ? Math.floor(points / 2) : 0;
}
export function ladderYearPoints(guess: number, answer: number): number {
  const d = distance(guess, answer);
  if (d === 0) return 5;
  if (d <= 2) return 3;
  return eraOf(guess) === eraOf(answer) ? 1 : 0;
}
export function ladderYearBonus(guess: number, answer: number): number {
  const d = distance(guess, answer);
  return d === 0 ? 3 : d <= 2 ? 1 : 0;
}
export function higherLowerCorrect(
  refYear: number,
  year: number,
  call: "earlier" | "later",
): boolean {
  return call === "earlier" ? year <= refYear : year >= refYear;
}
export function lineupPoints(
  order: readonly string[],
  years: Readonly<Record<string, number>>,
): number {
  const values = order.map((id) => {
    if (!Object.hasOwn(years, id)) throw new Error(`No year for card ${id}.`);
    return years[id];
  });
  let points = 0;
  let pairs = 0;
  for (let i = 0; i < values.length; i++)
    for (let j = i + 1; j < values.length; j++) {
      pairs++;
      if (values[i] <= values[j]) points++;
    }
  return points === pairs ? points + 2 : points;
}
export function imposterPoints(
  pickedOriginal: boolean,
  yearGuess: number | undefined,
  originalYear: number,
): number {
  return (
    (pickedOriginal ? 5 : 0) +
    (yearGuess !== undefined && distance(yearGuess, originalYear) <= 2 ? 3 : 0)
  );
}
export const nameItAward = (titleOK: boolean, artistOK: boolean): boolean =>
  titleOK && artistOK;

// Imposter pairs (section 8.3).
export type Relation = "originalOf" | "coverOf" | "remasterOf";
export interface ImposterPair {
  a: string;
  b: string;
  original: string;
}
export function imposterPairs(
  cards: readonly {
    id: string;
    relatedTo?: { cardId: string; relation: Relation };
  }[],
  seed: number,
): ImposterPair[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  if (byId.size !== cards.length) throw new Error("Card IDs must be unique.");
  const derived = (id: string): boolean => {
    const relation = byId.get(id)?.relatedTo?.relation;
    return relation === "coverOf" || relation === "remasterOf";
  };
  const found = new Map<string, { original: string; other: string }>();
  const add = (original: string, other: string) =>
    found.set(JSON.stringify([original, other]), { original, other });
  for (const card of cards) {
    const link = card.relatedTo;
    if (!link) continue;
    if (derived(card.id)) {
      if (byId.has(link.cardId) && !derived(link.cardId))
        add(link.cardId, card.id);
    } else if (link.relation === "originalOf" && byId.has(link.cardId))
      add(card.id, link.cardId);
  }
  const sorted = [...found.values()].sort(
    (x, y) =>
      compareCodePoints(x.original, y.original) ||
      compareCodePoints(x.other, y.other),
  );
  const rng = mulberry32(deriveSeed(seed, "pairs"));
  return shuffle(sorted, rng).map(({ original, other }) =>
    rng.next() % 2 === 0
      ? { a: original, b: other, original }
      : { a: other, b: original, original },
  );
}

// Which pair to draw next (section 1.5): the first pair not yet played that shares no
// card with the last pair drawn, else the first pair not yet played.
export function nextImposterPair(
  pairs: readonly ImposterPair[],
  drawn: readonly (readonly [string, string])[],
): ImposterPair | undefined {
  const open = pairs.filter(
    (pair) =>
      !drawn.some(([x, y]) => (x === pair.a && y === pair.b) || (x === pair.b && y === pair.a)),
  );
  const last = drawn[drawn.length - 1];
  const apart = (pair: ImposterPair): boolean =>
    !last || (pair.a !== last[0] && pair.a !== last[1] && pair.b !== last[0] && pair.b !== last[1]);
  return open.find(apart) ?? open[0];
}

// Daily Eratic (section 6.8). Dates are proleptic Gregorian, handled as integers.
const leapYear = (y: number): boolean =>
  (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const daysIn = (y: number, m: number): number =>
  m === 2 ? (leapYear(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
function parseDate(date: string): [number, number, number] | undefined {
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(date);
  if (!match) return undefined;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m) ? [y, m, d] : undefined;
}
export const isValidDate = (date: string): boolean =>
  parseDate(date) !== undefined;
const pad = (value: number, width: number): string =>
  String(value).padStart(width, "0");
// The day before a valid date; undefined for 0000-01-01, which has none.
function dayBefore(date: string): string | undefined {
  const parsed = parseDate(date);
  if (!parsed) throw new Error(`Invalid date: ${date}.`);
  let [y, m, d] = parsed;
  if (d > 1) d--;
  else if (m > 1) {
    m--;
    d = daysIn(y, m);
  } else {
    if (y === 0) return undefined;
    y--;
    m = 12;
    d = 31;
  }
  return `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`;
}
export function previousDay(date: string): string {
  const day = dayBefore(date);
  if (day === undefined) throw new Error("No day before 0000-01-01.");
  return day;
}
export function dailyStreak(
  previous: { lastDate: string; streak: number } | undefined,
  date: string,
): number {
  if (!isValidDate(date)) throw new Error(`Invalid date: ${date}.`);
  if (!previous) return 1;
  if (!isValidDate(previous.lastDate))
    throw new Error(`Invalid date: ${previous.lastDate}.`);
  if (previous.lastDate === date) return previous.streak;
  return previous.lastDate === dayBefore(date) ? previous.streak + 1 : 1;
}
// Round i (from 1): rounds 1-3 are Era Sort, later rounds Bullseye.
export function dailyRoundKind(round: number): "eraSort" | "bullseye" {
  if (!Number.isInteger(round) || round < 1) throw new Error(`Invalid round: ${round}.`);
  return round <= 3 ? "eraSort" : "bullseye";
}
export function dailyMaxScore(n: number): number {
  return 3 * Math.min(3, n) + 10 * Math.max(0, n - 3);
}
export function dailyShareText(
  date: string,
  score: number,
  maxScore: number,
  eraIds: readonly string[],
): string {
  return `Eratic ${date} · ${score}/${maxScore} · ${eraIds.map(eraName).join(" ")}`;
}
