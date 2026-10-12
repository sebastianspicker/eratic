// Undo before the reveal, at the controller: which entries can be taken back, and that the
// shortened log is replayed and saved. Scores come from the core engine.
import { beforeEach, describe, expect, it } from "vitest";
import demo from "../../../../../contract/demo-deck.json";
import type { Deck } from "../../core/deck";
import type { GameMode } from "../../core/session";
import { loadSession, SESSION_KEY } from "../../sessions";
import { defaultOptions, sessionOptions } from "./modes";
import { cardRef, GameController } from "./useGame";

const deck = demo as unknown as Deck;
const card = cardRef(deck.cards[0]);
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
function game(mode: GameMode, names: string[], options: Record<string, unknown> = {}) {
  let clock = 0;
  const controller = new GameController(storage, () => (clock += 1000), () => 7);
  const started = controller.start(
    {
      mode,
      options: sessionOptions(mode, { ...defaultOptions(mode), ...options }),
      players: names.map((name, i) => ({ id: `p${i + 1}`, name })),
      source: "draw",
      easyOnly: false,
    },
    deck,
  );
  expect(controller.getSnapshot().notice).toBe("");
  expect(started).toBe(true);
  return controller;
}
const types = (controller: GameController) => controller.getSnapshot().session!.actions.map((action) => action.type);
const saved = () => JSON.parse(storage.getItem(SESSION_KEY)!).actions;

describe("Undo before the reveal", () => {
  it("removes Bullseye's wager and guess together, and saves the shortened log", () => {
    const controller = game("bullseye", ["Ada", "Lin"], { stakes: true, rounds: 1 });
    controller.dispatch({ type: "draw", card });
    controller.dispatch({ type: "wager", playerId: "p1", chips: 2 });
    controller.dispatch({ type: "guess", playerId: "p1", year: 1980 });
    expect(controller.undoable()).toEqual({ playerId: "p1" });
    expect(controller.undo()).toBe(true);
    expect(types(controller)).toEqual(["draw"]);
    expect(saved()).toEqual(controller.getSnapshot().session!.actions);
    expect(loadSession(storage).session?.actions).toHaveLength(1);
    expect(controller.undoable()).toBeUndefined();
    expect(controller.undo()).toBe(false);
    // The player can enter again, with the chips back.
    expect(controller.dispatch({ type: "wager", playerId: "p1", chips: 3 })).toBe(true);
  });

  it("undoes a Timeline challenge first, then the placement", () => {
    const controller = game("timeline", ["Ada", "Lin"], { ownership: "shared" });
    // The anchor is already on the line; draw another card.
    const [fresh] = controller.nextDeckCards(deck);
    expect(controller.dispatch({ type: "draw", card: cardRef(fresh) })).toBe(true);
    expect(controller.dispatch({ type: "place", playerId: "p1", slot: 0 })).toBe(true);
    expect(controller.dispatch({ type: "challenge", playerId: "p2", slot: 1 })).toBe(true);
    expect(controller.undoable()).toEqual({ playerId: "p2" });
    controller.undo();
    expect(types(controller).slice(-2)).toEqual(["draw", "place"]);
    expect(controller.undoable()).toEqual({ playerId: "p1" });
    controller.undo();
    expect(types(controller).at(-1)).toBe("draw");
    expect(controller.undoable()).toBeUndefined();
  });

  it("undoes Timeline's Name It and wager one at a time, keeping the placement", () => {
    const controller = game("timeline", ["Ada", "Lin"], { ownership: "shared", nameIt: true, stakes: true });
    const [fresh] = controller.nextDeckCards(deck);
    expect(controller.dispatch({ type: "draw", card: cardRef(fresh) })).toBe(true);
    expect(controller.dispatch({ type: "place", playerId: "p1", slot: 0 })).toBe(true);
    expect(controller.dispatch({ type: "wager", playerId: "p1", chips: 1 })).toBe(true);
    expect(controller.dispatch({ type: "nameIt", playerId: "p1", titleOK: true, artistOK: false })).toBe(true);
    controller.undo();
    expect(types(controller).slice(-3)).toEqual(["draw", "place", "wager"]);
    controller.undo();
    expect(types(controller).slice(-2)).toEqual(["draw", "place"]);
  });

  it("keeps clip records: they don't block undo and stay in the log", () => {
    const controller = game("bullseye", ["Ada"], { rounds: 1 });
    controller.dispatch({ type: "draw", card });
    controller.dispatch({ type: "guess", playerId: "p1", year: 1980 });
    controller.dispatch({ type: "clip", fromMs: 0, lengthMs: 5000 });
    expect(controller.undoable()).toEqual({ playerId: "p1" });
    expect(controller.undo()).toBe(true);
    expect(types(controller)).toEqual(["draw", "clip"]);
    expect(saved().map((action: { type: string }) => action.type)).toEqual(["draw", "clip"]);
  });

  it("is not undoable after a Ladder step following a lock", () => {
    const controller = game("ladder", ["Ada", "Lin"], { rounds: 1 });
    controller.dispatch({ type: "draw", card });
    controller.dispatch({ type: "step", index: 0 });
    controller.dispatch({ type: "lock", playerId: "p1" });
    expect(controller.undoable()).toEqual({ playerId: "p1" });
    controller.dispatch({ type: "step", index: 1 });
    expect(controller.undoable()).toBeUndefined();
    expect(controller.undo()).toBe(false);
  });

  it("undoes only the last of two Ladder locks", () => {
    const controller = game("ladder", ["Ada", "Lin"], { rounds: 1 });
    controller.dispatch({ type: "draw", card });
    controller.dispatch({ type: "step", index: 0 });
    controller.dispatch({ type: "lock", playerId: "p1" });
    controller.dispatch({ type: "lock", playerId: "p2" });
    expect(controller.undoable()).toEqual({ playerId: "p2" });
    controller.undo();
    expect(types(controller).at(-1)).toBe("lock");
  });

  it("offers nothing after the reveal, a draw or a skip", () => {
    const controller = game("bullseye", ["Ada"], { rounds: 2 });
    controller.dispatch({ type: "draw", card });
    controller.dispatch({ type: "guess", playerId: "p1", year: 1980 });
    controller.dispatch({ type: "reveal" });
    expect(controller.undoable()).toBeUndefined();
    expect(controller.undo()).toBe(false);
    controller.dispatch({ type: "draw", card: cardRef(deck.cards[1]) });
    expect(controller.undoable()).toBeUndefined();
    controller.dispatch({ type: "skip" });
    expect(controller.undoable()).toBeUndefined();
  });
});
