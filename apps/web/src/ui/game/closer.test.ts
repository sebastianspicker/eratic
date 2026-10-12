// Higher or Lower with closer, at the controller: draws use closerPick over the unused cards
// in draw order, around the current reference card.
import { beforeEach, describe, expect, it } from "vitest";
import demo from "../../../../../contract/demo-deck.json";
import type { Deck } from "../../core/deck";
import { closerPick, drawOrder } from "../../core/random";
import { defaultOptions, sessionOptions } from "./modes";
import { GameController } from "./useGame";

const YEARS = [1955, 1958, 1971, 1979, 1984, 1990, 1997, 2003, 2011, 2019];
const deck = {
  ...demo,
  cards: YEARS.map((year, i) => ({
    ...structuredClone(demo.cards[0]),
    id: `c-${i}`,
    title: `Song ${i}`,
    gameYear: { value: year, source: "Fictional" },
  })),
} as unknown as Deck;
const yearOf = (id: string) => deck.cards.find((card) => card.id === id)!.gameYear.value;
let storage: Storage;
beforeEach(() => {
  const map = new Map<string, string>();
  storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  };
});
function game(options: Record<string, unknown>) {
  const controller = new GameController(storage, () => 0, () => 7);
  const started = controller.start(
    {
      mode: "higherLower",
      options: sessionOptions("higherLower", { ...defaultOptions("higherLower"), ...options }),
      players: [{ id: "p1", name: "Ada" }],
      source: "draw",
      easyOnly: false,
    },
    deck,
  );
  expect(started).toBe(true);
  return controller;
}
const drawn = (controller: GameController) =>
  controller.getSnapshot().session!.actions.filter((action) => action.type === "draw").map((action) => (action as { card: { cardId: string } }).card.cardId);

describe("Higher or Lower draws", () => {
  it("with closer, picks the first unused card within the window of the reference, by reveals so far", () => {
    const controller = game({ closer: true });
    expect(controller.getSnapshot().session!.options.closer).toBe(true);
    const seed = controller.getSnapshot().session!.seed;
    let reference = drawOrder(deck.cards.map((card) => card.id), seed)[0];
    const used = new Set([reference]);
    for (let round = 0; round < 3; round++) {
      const candidates = drawOrder(deck.cards.map((card) => card.id), seed)
        .filter((id) => !used.has(id))
        .map((id) => ({ id, year: yearOf(id) }));
      const expected = closerPick(candidates, yearOf(reference), round);
      expect(controller.draw(deck)).toBe(true);
      expect(drawn(controller).at(-1)).toBe(expected);
      used.add(expected!);
      // The right call keeps the game going; the reveal makes the drawn card the reference.
      const call = yearOf(expected!) > yearOf(reference) ? "later" : "earlier";
      expect(controller.dispatch({ type: "call", playerId: "p1", call })).toBe(true);
      expect(controller.dispatch({ type: "reveal" })).toBe(true);
      reference = expected!;
    }
    expect(drawn(controller)).toHaveLength(3);
  });

  it("without closer, draws in plain draw order", () => {
    const controller = game({});
    const seed = controller.getSnapshot().session!.seed;
    const order = drawOrder(deck.cards.map((card) => card.id), seed);
    expect(controller.draw(deck)).toBe(true);
    expect(drawn(controller)).toEqual([order[1]]);
  });
});
