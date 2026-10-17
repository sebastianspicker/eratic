import { describe, expect, it } from "vitest";
import primitiveCases from "../../../../contract/cases/game-primitives.json";
import trackCases from "../../../../contract/cases/provider-tracks.json";
import scanCases from "../../../../contract/cases/scan-resolution.json";
import { validateDeck } from "./deck";
import { eraIndex, eraName, eraOf, isAdjacent } from "./eras";
import {
  closerPick,
  compareCodePoints,
  dailySelection,
  deriveSeed,
  drawOrder,
  fnv1a32,
  mulberry32,
  pickAnchors,
  shuffle,
} from "./random";
import { songKey, suggestRelations } from "./relations";
import { eraticCardURL, linkTrack, providerTrack, resolveScan } from "./scan";
import * as scoring from "./scoring";

type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const primitives: Record<string, (args: Args) => unknown> = {
  mulberry32: ({ seed, count }) => {
    const rng = mulberry32(seed);
    return Array.from({ length: count }, () => rng.next());
  },
  fnv1a32: ({ text }) => fnv1a32(text),
  deriveSeed: ({ seed, salt }) => deriveSeed(seed, salt),
  shuffle: ({ items, seed }) => shuffle(items, seed),
  compareCodePoints: ({ a, b }) => Math.sign(compareCodePoints(a, b)),
  drawOrder: ({ cardIds, seed }) => drawOrder(cardIds, seed),
  pickAnchors: ({ cards, kind, seed, count, year }) =>
    pickAnchors(cards, kind, seed, count, year),
  dailySelection: ({ cardIds, date, deckId }) =>
    dailySelection(cardIds, date, deckId),
  isValidDate: ({ date }) => scoring.isValidDate(date),
  previousDay: ({ date }) => scoring.previousDay(date),
  dailyStreak: ({ previous, date }) => scoring.dailyStreak(previous, date),
  dailyMaxScore: ({ n }) => scoring.dailyMaxScore(n),
  dailyShareText: ({ date, score, maxScore, eraIds }) =>
    scoring.dailyShareText(date, score, maxScore, eraIds),
  eraOf: ({ year }) => eraOf(year),
  eraIndex: ({ id }) => eraIndex(id),
  eraName: ({ id }) => eraName(id),
  isAdjacent: ({ a, b }) => isAdjacent(a, b),
  eraSortPoints: ({ guessEra, answerYear, kids }) =>
    scoring.eraSortPoints(guessEra, answerYear, kids),
  placementCorrect: ({ years, slot, year }) =>
    scoring.placementCorrect(years, slot, year),
  insertionIndex: ({ years, year }) => scoring.insertionIndex(years, year),
  distance: ({ a, b }) => scoring.distance(a, b),
  bullseyePoints: ({ guess, answer }) => scoring.bullseyePoints(guess, answer),
  ladderPoints: ({ stepIndex, titleOK, artistOK }) =>
    scoring.ladderPoints(stepIndex, titleOK, artistOK),
  ladderYearPoints: ({ guess, answer }) =>
    scoring.ladderYearPoints(guess, answer),
  ladderYearBonus: ({ guess, answer }) => scoring.ladderYearBonus(guess, answer),
  higherLowerCorrect: ({ refYear, year, call }) =>
    scoring.higherLowerCorrect(refYear, year, call),
  lineupPoints: ({ order, years }) => scoring.lineupPoints(order, years),
  imposterPoints: ({ pickedOriginal, yearGuess, originalYear }) =>
    scoring.imposterPoints(pickedOriginal, yearGuess, originalYear),
  nameItAward: ({ titleOK, artistOK }) => scoring.nameItAward(titleOK, artistOK),
  imposterPairs: ({ cards, seed }) => scoring.imposterPairs(cards, seed),
  nextImposterPair: ({ pairs, drawn }) => scoring.nextImposterPair(pairs, drawn) ?? null,
  eraticCardURL: ({ host, deckId, cardId }) => eraticCardURL(host, deckId, cardId) ?? null,
  closerPick: ({ candidates, referenceYear, revealed }) =>
    closerPick(candidates, referenceYear, revealed) ?? null,
  songKey: ({ text }) => songKey(text),
  suggestRelations: ({ cards }) =>
    suggestRelations(
      cards.map(({ year, ...card }: Args) => ({ ...card, gameYear: { value: year } })),
    ),
};

type PrimitiveCase = {
  name: string;
  fn: string;
  args: Args;
  expected?: unknown;
  error?: boolean;
};
describe("contract: game-primitives", () => {
  const list = primitiveCases.cases as PrimitiveCase[];
  it("has cases", () => expect(list.length).toBeGreaterThan(0));
  it("covers every function it dispatches", () =>
    expect(new Set(list.map((item) => item.fn))).toEqual(
      new Set(Object.keys(primitives)),
    ));
  for (const item of list)
    it(item.name, () => {
      const run = primitives[item.fn];
      expect(run, `unknown fn ${item.fn}`).toBeDefined();
      if (item.error) return expect(() => run(item.args)).toThrow();
      expect(run(item.args)).toEqual(item.expected);
    });
});
describe("contract: provider-tracks", () => {
  type TrackCase = {
    name: string;
    input: { url?: string; link?: Parameters<typeof linkTrack>[0] };
    expected: unknown;
  };
  const list = trackCases.cases as TrackCase[];
  it("has cases", () => expect(list.length).toBeGreaterThan(0));
  for (const item of list)
    it(item.name, () => {
      const { url, link } = item.input;
      expect(url !== undefined || link !== undefined).toBe(true);
      const got = link ? linkTrack(link) : providerTrack(url as string);
      expect(got ?? null).toEqual(item.expected);
    });
});
describe("contract: scan-resolution", () => {
  type ScanCase = {
    name: string;
    deck: unknown;
    hosts: string[];
    payload: string;
    expected: unknown;
  };
  const list = scanCases.cases as ScanCase[];
  it("has cases", () => expect(list.length).toBeGreaterThan(0));
  for (const item of list)
    it(item.name, () => {
      const deck = validateDeck(structuredClone(item.deck));
      expect(resolveScan(item.payload, deck, item.hosts)).toEqual(item.expected);
    });
});
