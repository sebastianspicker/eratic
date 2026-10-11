import { describe, expect, it } from "vitest";
import { applyAction, startGame, suddenDeathCards, type GameState } from "./game/engine";
import { dailyRoundKind } from "./scoring";
import type { GameAction, GameMode, SessionOptions } from "./session";

// Small core queries the UI reads instead of restating rules.
const card = (cardId: string, year: number, era: string) => ({ cardId, year, era });
const players = [
  { id: "p1", name: "Ada" },
  { id: "p2", name: "Lin" },
];
type Input = GameAction extends infer A ? (A extends GameAction ? Omit<A, "at"> : never) : never;
function play(mode: GameMode, options: SessionOptions, actions: Input[]): GameState {
  let state = startGame({ mode, options, players, seed: 1 });
  actions.forEach((action, index) => {
    state = applyAction(state, { ...action, at: index } as GameAction, index);
  });
  return state;
}

describe("dailyRoundKind", () => {
  it("is Era Sort for rounds 1 to 3 and Bullseye after", () => {
    expect([1, 2, 3, 4, 5].map(dailyRoundKind)).toEqual(["eraSort", "eraSort", "eraSort", "bullseye", "bullseye"]);
  });
  it("rejects rounds outside its domain", () => {
    for (const round of [0, -1, 1.5]) expect(() => dailyRoundKind(round)).toThrow();
  });
});

describe("suddenDeathCards", () => {
  it("is 0 outside a sudden death", () => {
    expect(suddenDeathCards(play("bullseye", { rounds: 1 }, []))).toBe(0);
  });
  it("is one card for a closest-year sudden death", () => {
    const state = play("bullseye", { rounds: 1 }, [
      { type: "draw", card: card("c1", 1984, "neon") },
      { type: "guess", playerId: "p1", year: 1980 },
      { type: "guess", playerId: "p2", year: 1980 },
      { type: "reveal" },
    ]);
    expect(state.phase).toBe("suddenDeath");
    expect(suddenDeathCards(state)).toBe(1);
  });
  it("is the lineup size for a Lineup sudden death", () => {
    const set = [card("c1", 1984, "neon"), card("c2", 1990, "zine"), card("c3", 1971, "disco")];
    const order = set.map((item) => item.cardId);
    const state = play("lineup", { k: 3, rounds: 1 }, [
      { type: "drawSet", cards: set },
      { type: "order", playerId: "p1", order },
      { type: "order", playerId: "p2", order },
      { type: "reveal" },
    ]);
    expect(state.phase).toBe("suddenDeath");
    expect(suddenDeathCards(state)).toBe(3);
  });
});
