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
});
