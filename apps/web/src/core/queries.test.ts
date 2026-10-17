import { describe, expect, it } from "vitest";
import {
  activePlayer,
  applyAction,
  finalRoundPlayers,
  openChallengeSlots,
  pendingInputs,
  startGame,
  suddenDeathCards,
  summarize,
  type GameState,
} from "./game/engine";
import { eraOf } from "./eras";
import { usedCardIds } from "./session";
import { suggestRelations } from "./relations";
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

describe("usedCardIds in Original or Imposter", () => {
  it("lists the cards of drawn pairs, once each, though a card may be paired again", () => {
    let state = play("imposter", {}, [
      { type: "drawPair", a: card("a", 1960, eraOf(1960)), b: card("b", 1990, eraOf(1990)), original: "a" },
    ]);
    expect(usedCardIds(state)).toEqual(["a", "b"]);
    state = applyAction(state, { type: "skip", at: 5 }, 1);
    state = applyAction(
      state,
      { type: "drawPair", at: 6, a: card("a", 1960, eraOf(1960)), b: card("c", 1975, eraOf(1975)), original: "a" },
      2,
    );
    expect(usedCardIds(state)).toEqual(["a", "b", "c"]);
  });
});

describe("pendingInputs in a first-to-name sudden death", () => {
  it("lists the tied players until the song is named", () => {
    let state = play("ladder", { rounds: 1, steps: [1000] }, [
      { type: "draw", card: card("c1", 1984, "neon") },
      { type: "step", index: 0 },
      { type: "lock", playerId: "p1" },
      { type: "lock", playerId: "p2" },
      { type: "mark", playerId: "p1", titleOK: true, artistOK: true },
      { type: "mark", playerId: "p2", titleOK: true, artistOK: true },
      { type: "reveal" },
      { type: "sdDraw", cards: [card("c2", 1990, "zine")] },
    ]);
    expect(state.phase).toBe("suddenDeathOpen");
    expect(pendingInputs(state)).toEqual(["p1", "p2"]);
    state = applyAction(state, { type: "sdName", at: 20 }, 8);
    expect(pendingInputs(state)).toEqual([]);
  });
});

describe("Higher or Lower with everyone calling", () => {
  it("has no active player and awaits every player still in", () => {
    const state = play("higherLower", { play: "everyone" }, [
      { type: "reference", card: card("c1", 1980, "neon") },
      { type: "draw", card: card("c2", 1990, "zine") },
      { type: "call", playerId: "p2", call: "later" },
    ]);
    expect(activePlayer(state)).toBeUndefined();
    expect(summarize(state)).not.toHaveProperty("active");
    expect(pendingInputs(state)).toEqual(["p1"]);
  });
  it("keeps the active player in turns", () => {
    const state = play("higherLower", {}, [{ type: "reference", card: card("c1", 1980, "neon") }]);
    expect(summarize(state).active).toBe("p1");
    expect(summarize(state)).not.toHaveProperty("lives");
  });
});

describe("Timeline final round and challenge slots", () => {
  const trio = [...players, { id: "p3", name: "Kit" }];
  function timelineGame(options: Partial<SessionOptions>, actions: Input[]): GameState {
    let state = startGame({
      mode: "timeline",
      options: { ownership: "shared", anchor: "random", target: 2, challenges: true, tokens: 2, nameIt: false, stakes: false, clip: "full", ...options } as SessionOptions,
      players: trio,
      seed: 1,
    });
    actions.forEach((action, index) => {
      state = applyAction(state, { ...action, at: index } as GameAction, index);
    });
    return state;
  }
  const anchor: Input = { type: "anchor", card: card("a", 1980, eraOf(1980)) };
  const draw = (id: string, year: number): Input => ({ type: "draw", card: card(id, year, eraOf(year)) });

  it("has no final round before the target is reached or in other modes", () => {
    expect(finalRoundPlayers(timelineGame({}, [anchor, draw("c1", 1990)]))).toBeUndefined();
    expect(finalRoundPlayers(play("bullseye", { rounds: 1 }, []))).toBeUndefined();
  });
  it("names the players still to play once a non-last player reaches the target", () => {
    const state = timelineGame({}, [
      anchor,
      draw("c1", 1990),
      { type: "place", playerId: "p1", slot: 1 },
      { type: "reveal" },
      draw("c2", 1995),
    ]);
    expect(finalRoundPlayers(state)).toEqual(["p2", "p3"]);
  });
  it("shrinks with each turn and ends with the game", () => {
    const state = timelineGame({}, [
      anchor,
      draw("c1", 1990),
      { type: "place", playerId: "p1", slot: 1 },
      { type: "reveal" },
      draw("c2", 1995),
      { type: "place", playerId: "p2", slot: 0 },
      { type: "reveal" },
      draw("c3", 1996),
    ]);
    expect(finalRoundPlayers(state)).toEqual(["p3"]);
    const done = applyAction(
      applyAction(state, { type: "place", playerId: "p3", slot: 0, at: 9 } as GameAction, 9),
      { type: "reveal", at: 10 } as GameAction,
      10,
    );
    expect(done.phase).not.toBe("open");
    expect(finalRoundPlayers(done)).toBeUndefined();
  });
  it("lists the free challenge slots, none before the placement", () => {
    const start = [anchor, draw("c1", 1990)];
    expect(openChallengeSlots(timelineGame({}, start))).toEqual([]);
    const placed = timelineGame({}, [...start, { type: "place", playerId: "p1", slot: 1 }]);
    expect(openChallengeSlots(placed)).toEqual([0]);
    expect(openChallengeSlots(timelineGame({ challenges: false }, [...start, { type: "place", playerId: "p1", slot: 1 }]))).toEqual([]);
  });
  it("drops a slot once challenged and is empty when all are taken", () => {
    const start: Input[] = [anchor, draw("c1", 1990), { type: "place", playerId: "p1", slot: 1 }];
    const one = timelineGame({}, [...start, { type: "challenge", playerId: "p2", slot: 0 }]);
    expect(openChallengeSlots(one)).toEqual([]);
    const two = timelineGame({ ownership: "shared" }, [
      anchor,
      draw("c1", 1990),
      { type: "place", playerId: "p1", slot: 0 },
    ]);
    expect(openChallengeSlots(two)).toEqual([1]);
  });
});

describe("suggestRelations", () => {
  const song = (id: string, year: number, relatedTo?: { cardId: string; relation: "coverOf" }) => ({
    id,
    title: "Hello",
    artist: "X",
    gameYear: { value: year },
    ...(relatedTo && { relatedTo }),
  });
  it("never suggests a card that already has relatedTo", () => {
    expect(suggestRelations([song("a", 1970), song("b", 1980, { cardId: "a", relation: "coverOf" })])).toEqual([]);
  });
});
