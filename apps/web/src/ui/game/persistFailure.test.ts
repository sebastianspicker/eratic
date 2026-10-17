// A game whose saves start failing mid-game: the host is told, and the cause is kept for bug reports.
import { afterEach, describe, expect, it } from "vitest";
import demo from "../../../../../contract/demo-deck.json";
import type { Deck } from "../../core/deck";
import { clearDiagnostics, diagnosticsText } from "../../diagnostics";
import { defaultOptions, sessionOptions } from "./modes";
import { cardRef, GameController } from "./useGame";

const deck = demo as unknown as Deck;
afterEach(clearDiagnostics);

describe("session persist failures", () => {
  it("shows the storage notice and records the underlying error", () => {
    const map = new Map<string, string>();
    let full = false;
    const storage: Storage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        if (full) throw new DOMException("Quota exceeded", "QuotaExceededError");
        map.set(key, value);
      },
      removeItem: (key) => void map.delete(key),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    };
    let clock = 0;
    const controller = new GameController(storage, () => (clock += 1000), () => 7);
    controller.start(
      {
        mode: "bullseye",
        options: sessionOptions("bullseye", defaultOptions("bullseye")),
        players: [{ id: "p1", name: "Ada" }],
        source: "draw",
        easyOnly: false,
      },
      deck,
    );
    expect(controller.getSnapshot().storageNotice).toBe("");
    full = true;
    expect(controller.dispatch({ type: "draw", card: cardRef(deck.cards[0]) })).toBe(true);
    expect(controller.getSnapshot().storageNotice).toBe("Browser storage is unavailable. This game won't survive a reload.");
    expect(diagnosticsText()).toContain(
      "[game] Browser storage is unavailable. This game won't survive a reload. (Quota exceeded)",
    );
  });

  it("keeps the refused-settings notice through later saves until the game closes", () => {
    const map = new Map<string, string>();
    const storage: Storage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        if (key.includes("prefs")) throw new DOMException("Quota exceeded", "QuotaExceededError");
        map.set(key, value);
      },
      removeItem: (key) => void map.delete(key),
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    };
    let clock = 0;
    const controller = new GameController(storage, () => (clock += 1000), () => 7);
    const easy = { ...deck, cards: deck.cards.map((card) => ({ ...card, difficulty: 1 })) } as unknown as Deck;
    controller.start(
      {
        mode: "bullseye",
        options: sessionOptions("bullseye", defaultOptions("bullseye")),
        players: [{ id: "p1", name: "Ada" }],
        source: "draw",
        easyOnly: true,
      },
      easy,
    );
    const notice = "Browser storage refused the game's settings, so Easy cards only won't survive a reload.";
    expect(controller.getSnapshot().gameNotices).toEqual([notice]);
    controller.dispatch({ type: "draw", card: cardRef(easy.cards[0]) });
    expect(controller.getSnapshot().storageNotice).toBe("");
    expect(controller.getSnapshot().gameNotices).toEqual([notice]);
    controller.close();
    expect(controller.getSnapshot().gameNotices).toEqual([]);
  });
});
