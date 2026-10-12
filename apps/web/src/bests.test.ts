import { describe, expect, it } from "vitest";
import { bestKind, BESTS_KEY, compareBest, loadBests, parseBests, recordBest } from "./bests";
import type { Session } from "./core/session";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => void data.delete(key),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}
const session = (
  mode: Session["mode"],
  players: number,
  options: Session["options"] = {},
  actions: Session["actions"] = [],
) =>
  ({
    mode,
    sessionVersion: 2,
    options,
    actions,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` })),
  }) as unknown as Session;

describe("personal bests", () => {
  it("reads corrupt or malformed storage as empty and keeps only well-formed entries", () => {
    expect(parseBests(null)).toEqual({});
    expect(parseBests("{not json")).toEqual({});
    expect(parseBests("[1,2]")).toEqual({});
    expect(parseBests('"text"')).toEqual({});
    const parsed = parseBests(
      JSON.stringify({
        deck: {
          "solo-bullseye": { score: 42, sessionId: "s1" },
          relay: { score: "12", sessionId: "s2" },
          "solo-eraSort": { score: 3 },
        },
        other: [1],
      }).replace(/}$/, ',"__proto__":{"relay":{"score":1,"sessionId":"x"}}}'),
    );
    expect(Object.keys(parsed)).toEqual(["deck", "__proto__"]);
    expect(parsed.deck).toEqual({ "solo-bullseye": { score: 42, sessionId: "s1" } });
    // A stored "__proto__" ID stays a plain key and never reaches Object.prototype.
    expect(Object.getOwnPropertyDescriptor(parsed, "__proto__")?.value).toEqual({ relay: { score: 1, sessionId: "x" } });
    expect(({} as Record<string, unknown>).relay).toBeUndefined();
    expect(loadBests(memoryStorage({ [BESTS_KEY]: "corrupt" }))).toEqual({});
  });

  it("counts Relay and solo games except Daily", () => {
    expect(bestKind(session("relay", 3))).toBe("relay-12-3");
    expect(bestKind(session("relay", 3, { target: 5, lives: 2 }))).toBe("relay-5-2");
    expect(bestKind(session("bullseye", 1))).toBe("solo-bullseye-10");
    expect(bestKind(session("bullseye", 1, { rounds: 3 }))).toBe("solo-bullseye-3");
    expect(bestKind(session("higherLower", 1, { cards: 20 }))).toBe("solo-higherLower-20");
    expect(bestKind(session("timeline", 1, { target: 7 }))).toBe("solo-timeline-7");
    expect(bestKind(session("lineup", 1, { k: 4, rounds: 5 }))).toBe("solo-lineup-4x5");
    expect(bestKind(session("lineup", 1))).toBe("solo-lineup-4x5");
    expect(bestKind(session("bullseye", 2))).toBeUndefined();
    expect(bestKind(session("daily", 1))).toBeUndefined();
  });

  it("does not count a game ended early with End game", () => {
    const ended = [{ type: "end", at: 1 }] as Session["actions"];
    expect(bestKind(session("bullseye", 1, { rounds: 3 }, ended))).toBeUndefined();
    expect(bestKind(session("relay", 2, {}, ended))).toBeUndefined();
  });

  it("records a game once per session and says New best only when it strictly beats the previous", () => {
    const storage = memoryStorage();
    expect(compareBest(loadBests(storage), "deck", "relay", 12, "s1")).toEqual({ best: 12, isNew: false, store: true });
    expect(recordBest("deck", "relay", 12, "s1", storage)).toBe(true);
    // The same session again (a resumed result) is not counted twice.
    expect(compareBest(loadBests(storage), "deck", "relay", 12, "s1")).toEqual({ best: 12, isNew: false, store: false });
    // A tie is not a new best and isn't stored.
    expect(compareBest(loadBests(storage), "deck", "relay", 12, "s2")).toEqual({ best: 12, isNew: false, store: false });
    recordBest("deck", "relay", 12, "s2", storage);
    expect(loadBests(storage).deck.relay).toEqual({ score: 12, sessionId: "s1" });
    expect(compareBest(loadBests(storage), "deck", "relay", 13, "s3")).toEqual({ best: 13, isNew: true, store: true });
    recordBest("deck", "relay", 13, "s3", storage);
    recordBest("deck", "solo-bullseye", 30, "s4", storage);
    recordBest("other", "relay", 5, "s5", storage);
    expect(JSON.parse(storage.getItem(BESTS_KEY)!)).toEqual({
      deck: { relay: { score: 13, sessionId: "s3" }, "solo-bullseye": { score: 30, sessionId: "s4" } },
      other: { relay: { score: 5, sessionId: "s5" } },
    });
  });

  it("reports unavailable storage instead of throwing", () => {
    const storage = memoryStorage();
    storage.setItem = () => {
      throw new Error("full");
    };
    expect(recordBest("deck", "relay", 1, "s1", storage)).toBe(false);
  });
});
