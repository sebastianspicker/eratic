import { describe, expect, it } from "vitest";
import { demoDeck, exportDeck, updateGameYear } from "./core/deck";
import {
  discardUnreadable,
  loadDeck,
  persistDeck,
  readUnreadable,
  STORAGE_KEY,
  UNREADABLE_KEY,
} from "./storage";

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
const BAD = '{"schemaVersion": 2}';

describe("storage", () => {
  it("loads a valid saved deck", () => {
    const saved = updateGameYear(demoDeck(), "demo-001", {
      value: 1990,
      source: "Liner notes",
    });
    const storage = fakeStorage({ [STORAGE_KEY]: exportDeck(saved) });
    const loaded = loadDeck(storage);
    expect(loaded.deck).toEqual(saved);
    expect(loaded).toMatchObject({ persisted: true, unreadable: false });
  });
  it("loads the sample when nothing is saved", () => {
    expect(loadDeck(fakeStorage())).toMatchObject({
      deck: demoDeck(),
      persisted: false,
      unreadable: false,
    });
  });
  it("quarantines an unreadable value and leaves the main key untouched", () => {
    const storage = fakeStorage({ [STORAGE_KEY]: BAD });
    const loaded = loadDeck(storage);
    expect(loaded.deck).toEqual(demoDeck());
    expect(loaded.notice).toMatch(/could not be read/);
    expect(loaded.unreadable).toBe(true);
    expect(storage.getItem(STORAGE_KEY)).toBe(BAD);
    expect(readUnreadable(storage)).toBe(BAD);
  });
  it("persists after quarantine", () => {
    const storage = fakeStorage({ [STORAGE_KEY]: BAD });
    loadDeck(storage);
    persistDeck(demoDeck(), storage);
    expect(storage.getItem(STORAGE_KEY)).toBe(exportDeck(demoDeck()));
    expect(storage.getItem(UNREADABLE_KEY)).toBe(BAD);
  });
  it("refuses to overwrite when the quarantine slot holds a different value", () => {
    const storage = fakeStorage({
      [STORAGE_KEY]: BAD,
      [UNREADABLE_KEY]: "older unreadable data",
    });
    expect(loadDeck(storage).unreadable).toBe(true);
    expect(() => persistDeck(demoDeck(), storage)).toThrow(
      /Download or discard/,
    );
    expect(storage.getItem(STORAGE_KEY)).toBe(BAD);
    expect(storage.getItem(UNREADABLE_KEY)).toBe("older unreadable data");
  });
  it("does not claim the data can be downloaded when the slot holds different data", () => {
    const storage = fakeStorage({
      [STORAGE_KEY]: BAD,
      [UNREADABLE_KEY]: "older unreadable data",
    });
    const { notice } = loadDeck(storage);
    expect(notice).not.toMatch(/can be downloaded/);
    expect(notice).toMatch(/left untouched/);
    expect(notice).toMatch(/saving is blocked/);
  });
  it("does not claim the data can be downloaded when quarantining fails", () => {
    const storage = fakeStorage({ [STORAGE_KEY]: BAD });
    storage.setItem = () => {
      throw new Error("quota");
    };
    const { notice, unreadable } = loadDeck(storage);
    expect(notice).not.toMatch(/can be downloaded/);
    expect(notice).toMatch(/left untouched/);
    expect(unreadable).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(BAD);
  });
  it("discards the unreadable value", () => {
    const storage = fakeStorage({ [UNREADABLE_KEY]: BAD });
    discardUnreadable(storage);
    expect(readUnreadable(storage)).toBeNull();
  });
  it("does not resurrect discarded data on the next save", () => {
    const storage = fakeStorage({ [STORAGE_KEY]: BAD });
    expect(loadDeck(storage).unreadable).toBe(true);
    discardUnreadable(storage);
    persistDeck(demoDeck(), storage);
    expect(readUnreadable(storage)).toBeNull();
    expect(storage.getItem(STORAGE_KEY)).not.toBe(BAD);
  });
  it("keeps a different unreadable main value when discarding the slot", () => {
    const storage = fakeStorage({
      [STORAGE_KEY]: BAD,
      [UNREADABLE_KEY]: "older unreadable data",
    });
    discardUnreadable(storage);
    expect(storage.getItem(STORAGE_KEY)).toBe(BAD);
    expect(readUnreadable(storage)).toBeNull();
  });
  it("survives storage that throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(loadDeck(broken)).toMatchObject({
      deck: demoDeck(),
      persisted: false,
      unreadable: false,
    });
  });
});
