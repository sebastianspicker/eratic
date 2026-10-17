import { describe, expect, it } from "vitest";
import { exportSession, type Session } from "./core/session";
import {
  clearSession,
  DAILY_KEY,
  discardUnreadableSession,
  loadPlayPrefs,
  PLAY_PREFS_KEY,
  savePlayPrefs,
  loadDaily,
  loadSession,
  persistSession,
  readUnreadableSession,
  recordDaily,
  SESSION_KEY,
  SESSION_UNREADABLE_KEY,
  UnreadableSessionSlotError,
  UNSEEN_KEY,
  loadUnseen,
  markUnseen,
} from "./sessions";

function fakeStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}
function brokenStorage(): Storage {
  const fail = () => {
    throw new Error("SecurityError");
  };
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  };
}
const session = (): Session => ({
  format: "eratic-session",
  sessionVersion: 1,
  id: "s-1",
  createdAt: "2026-10-11T19:30:00Z",
  deckId: "demo-deck",
  deckTitle: "Demo deck",
  mode: "bullseye",
  options: { rounds: 2 },
  seed: 7,
  players: [{ id: "p1", name: "Ada" }],
  actions: [{ type: "draw", at: 0, card: { cardId: "c1", year: 1984, era: "neon" } }],
});
const BAD = '{"format": "eratic-session"}';

describe("session storage", () => {
  it("round-trips the current session", () => {
    const storage = fakeStorage();
    persistSession(session(), storage);
    expect(storage.getItem(SESSION_KEY)).toBe(exportSession(session()));
    expect(loadSession(storage)).toMatchObject({ session: session(), unreadable: false });
  });
  it("quarantines an unreadable session before anything overwrites it", () => {
    const storage = fakeStorage({ [SESSION_KEY]: BAD });
    const loaded = loadSession(storage);
    expect(loaded.session).toBeUndefined();
    expect(loaded.unreadable).toBe(true);
    expect(loaded.notice).toMatch(/could not be read/);
    expect(readUnreadableSession(storage)).toBe(BAD);
    expect(storage.getItem(SESSION_KEY)).toBe(BAD);
    persistSession(session(), storage);
    expect(storage.getItem(SESSION_UNREADABLE_KEY)).toBe(BAD);
  });
  it("refuses to overwrite a second unreadable value", () => {
    const storage = fakeStorage({
      [SESSION_KEY]: "{broken",
      [SESSION_UNREADABLE_KEY]: BAD,
    });
    expect(() => persistSession(session(), storage)).toThrow(UnreadableSessionSlotError);
    expect(storage.getItem(SESSION_KEY)).toBe("{broken");
    clearSession(storage);
    expect(storage.getItem(SESSION_KEY)).toBe("{broken");
  });
  it("discards the quarantined value and the matching main value", () => {
    const storage = fakeStorage({ [SESSION_KEY]: BAD });
    loadSession(storage);
    discardUnreadableSession(storage);
    expect(storage.getItem(SESSION_KEY)).toBeNull();
    expect(readUnreadableSession(storage)).toBeNull();
  });
  it("clears a readable session", () => {
    const storage = fakeStorage();
    persistSession(session(), storage);
    clearSession(storage);
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });
  it("survives unavailable storage", () => {
    expect(loadSession(undefined)).toEqual({ unreadable: false, notice: "" });
    expect(loadSession(brokenStorage())).toEqual({ unreadable: false, notice: "" });
    expect(() => persistSession(session(), undefined)).toThrow(/unavailable/);
    expect(() => clearSession(brokenStorage())).not.toThrow();
    expect(readUnreadableSession(brokenStorage())).toBeNull();
    expect(loadDaily(brokenStorage())).toBeUndefined();
    expect(recordDaily("2026-10-11", 20, "demo-deck", undefined, brokenStorage())).toMatchObject({
      streak: 1,
    });
  });
});

describe("daily record", () => {
  it("counts the streak with the core's dailyStreak", () => {
    const storage = fakeStorage();
    expect(recordDaily("2026-10-10", 12, "demo-deck", "a", storage).streak).toBe(1);
    expect(recordDaily("2026-10-11", 20, "demo-deck", "b", storage)).toEqual({
      lastDate: "2026-10-11",
      streak: 2,
      lastScore: 20,
      deckId: "demo-deck",
      shareText: "b",
    });
    expect(recordDaily("2026-10-11", 9, "demo-deck", "c", storage).streak).toBe(2);
    expect(recordDaily("2026-10-13", 9, "demo-deck", "d", storage).streak).toBe(1);
    expect(loadDaily(storage)?.lastDate).toBe("2026-10-13");
  });
  it("treats a corrupt record as absent", () => {
    for (const raw of [
      "{oops",
      "[]",
      '{"lastDate": "2026-02-30", "streak": 3, "lastScore": 1, "deckId": "d"}',
      '{"lastDate": "2026-10-10", "streak": "3", "lastScore": 1, "deckId": "d"}',
    ]) {
      const storage = fakeStorage({ [DAILY_KEY]: raw });
      expect(loadDaily(storage)).toBeUndefined();
      expect(recordDaily("2026-10-11", 5, "d", undefined, storage).streak).toBe(1);
    }
  });
});

describe("play preferences", () => {
  it("round-trips Kids and still loads values stored without it", () => {
    const storage = fakeStorage();
    expect(savePlayPrefs("s1", { easyOnly: false, source: "draw", kids: true }, storage)).toBe(true);
    expect(loadPlayPrefs("s1", storage)).toEqual({ easyOnly: false, source: "draw", kids: true });
    storage.setItem(PLAY_PREFS_KEY, JSON.stringify({ s1: { easyOnly: true, source: "scan" } }));
    expect(loadPlayPrefs("s1", storage)).toEqual({ easyOnly: true, source: "scan" });
    expect(loadPlayPrefs("s1", storage)?.kids).toBeUndefined();
  });
});

describe("unseen results marker", () => {
  it("keeps the ID of a finished game under the Apple app's key, and clears it", () => {
    const storage = fakeStorage();
    expect(UNSEEN_KEY).toBe("eratic.play.unseen.v1");
    expect(loadUnseen(storage)).toBeNull();
    markUnseen("s1", storage);
    expect(storage.getItem(UNSEEN_KEY)).toBe("s1");
    expect(loadUnseen(storage)).toBe("s1");
    markUnseen(null, storage);
    expect(loadUnseen(storage)).toBeNull();
  });
  it("survives unavailable storage", () => {
    expect(loadUnseen(brokenStorage())).toBeNull();
    expect(() => markUnseen("s1", brokenStorage())).not.toThrow();
    expect(() => markUnseen(null, undefined)).not.toThrow();
  });
});
