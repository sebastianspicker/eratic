import { describe, expect, it } from "vitest";
import { applyAction, replay, startGame, summarize } from "./game/engine";
import {
  exportSession,
  normalizeOptions,
  parseSession,
  usedCardIds,
  validateSession,
  type Session,
} from "./session";

const card = (cardId: string, year: number, era: string) => ({ cardId, year, era });
function bullseyeSession(): Session {
  return {
    format: "eratic-session",
    sessionVersion: 1,
    id: "s-1",
    createdAt: "2026-10-11T19:30:00Z",
    deckId: "demo-deck",
    deckTitle: "Demo deck",
    mode: "bullseye",
    options: { stakes: true },
    seed: 7,
    players: [
      { id: "p1", name: "Ada" },
      { id: "p2", name: "Lin", members: ["Kai"] },
    ],
    actions: [
      { type: "draw", at: 0, card: card("c1", 1984, "neon") },
      { type: "guess", at: 10, playerId: "p1", year: 1984 },
      { type: "guess", at: 20, playerId: "p2", year: 1990 },
      { type: "wager", at: 30, playerId: "p1", chips: 2 },
      { type: "wager", at: 40, playerId: "p2", chips: 1 },
      { type: "reveal", at: 50 },
    ],
  };
}

describe("normalizeOptions", () => {
  it("fills every default", () => {
    expect(normalizeOptions("bullseye", {})).toEqual({ rounds: 10, stakes: false });
    expect(normalizeOptions("eraSort", {})).toEqual({ rounds: 10, kids: false });
    expect(normalizeOptions("timeline", {})).toEqual({
      ownership: "personal",
      anchor: "random",
      target: 10,
      challenges: true,
      tokens: 2,
      nameIt: false,
      stakes: false,
      clip: "full",
    });
    expect(normalizeOptions("ladder", {})).toEqual({
      rounds: 10,
      steps: [1000, 5000, 10000, 20000, 30000],
      guess: "name",
      clipStart: "card",
      stakes: false,
      buzzer: false,
    });
    expect(normalizeOptions("higherLower", {})).toEqual({
      cards: 10,
      play: "turns",
      closer: false,
    });
    expect(normalizeOptions("relay", {})).toEqual({
      target: 12,
      lives: 3,
      anchor: "random",
      nameIt: false,
    });
    expect(normalizeOptions("lineup", {})).toEqual({ k: 4, rounds: 5, clipMs: 10000 });
    expect(normalizeOptions("imposter", {})).toEqual({ rounds: 5 });
  });
  it("keeps given values and the custom anchor year", () => {
    expect(
      normalizeOptions("relay", { anchor: "custom", anchorYear: 1975, lives: 1 }),
    ).toEqual({ target: 12, lives: 1, anchor: "custom", anchorYear: 1975, nameIt: false });
    expect(
      normalizeOptions("daily", { date: "2024-02-29", cards: ["a", "b"] }),
    ).toEqual({ date: "2024-02-29", cards: ["a", "b"] });
  });
  it("rejects unknown, out-of-range and missing members", () => {
    expect(() => normalizeOptions("bullseye", { kids: true })).toThrow();
    expect(() => normalizeOptions("lineup", { rounds: 21 })).toThrow();
    expect(() => normalizeOptions("ladder", { steps: [5000, 1000] })).toThrow();
    expect(() => normalizeOptions("timeline", { anchor: "custom" })).toThrow();
    expect(() => normalizeOptions("daily", { cards: ["a"] })).toThrow();
  });
  it("keeps the version 1 ladder steps for legacy sessions", () => {
    expect(normalizeOptions("ladder", {}, 1).steps).toEqual([1000, 5000, 10000, 30000, 60000]);
    expect(normalizeOptions("ladder", { steps: [1000, 60000] }, 1).steps).toEqual([1000, 60000]);
    expect(() => normalizeOptions("ladder", { steps: [1000, 60000] }, 2)).toThrow();
    expect(() => normalizeOptions("ladder", { steps: [1000, 30001] })).toThrow();
    expect(normalizeOptions("ladder", { steps: [30000] }).steps).toEqual([30000]);
  });
  it("gives Higher or Lower lives only with everyone calling", () => {
    expect(normalizeOptions("higherLower", { play: "everyone" })).toEqual({
      cards: 10,
      play: "everyone",
      lives: 3,
      closer: false,
    });
    expect(normalizeOptions("higherLower", { play: "everyone", lives: 5 }).lives).toBe(5);
    expect(() => normalizeOptions("higherLower", { lives: 2 })).toThrow();
    expect(() => normalizeOptions("higherLower", { play: "turns", lives: 2 })).toThrow();
    expect(() => normalizeOptions("higherLower", { play: "everyone", lives: 0 })).toThrow();
    expect(() => normalizeOptions("higherLower", { play: "everyone", lives: 6 })).toThrow();
    expect(() =>
      normalizeOptions("higherLower", { play: "all" as unknown as "everyone" }),
    ).toThrow();
  });
  it("rejects the version 2 options in version 1 sessions", () => {
    expect(normalizeOptions("higherLower", {}, 1)).toEqual({ cards: 10 });
    expect(normalizeOptions("ladder", {}, 1)).not.toHaveProperty("buzzer");
    expect(() => normalizeOptions("higherLower", { play: "turns" }, 1)).toThrow();
    expect(() => normalizeOptions("higherLower", { play: "everyone", lives: 3 }, 1)).toThrow();
    expect(() => normalizeOptions("higherLower", { closer: false }, 1)).toThrow();
    expect(() => normalizeOptions("ladder", { buzzer: false }, 1)).toThrow();
  });
  it("does not share the default steps between calls", () => {
    const first = normalizeOptions("ladder", {});
    first.steps.push(1);
    expect(normalizeOptions("ladder", {}).steps).toHaveLength(5);
  });
});

describe("exportSession", () => {
  it("round-trips through parseSession with options normalised", () => {
    const session = bullseyeSession();
    const json = exportSession(session);
    expect(json.endsWith("}\n")).toBe(true);
    expect(json).toContain('\n  "format": "eratic-session",');
    const parsed = parseSession(json);
    expect(parsed).toEqual({ ...session, options: { rounds: 10, stakes: true } });
    expect(exportSession(parsed)).toBe(json);
  });
  it("keeps each session's version and ladder rules on export", () => {
    const ladder = (sessionVersion: 1 | 2, steps?: number[]): Session => ({
      ...bullseyeSession(),
      sessionVersion,
      mode: "ladder",
      options: { rounds: 1, ...(steps ? { steps } : {}) },
      actions: [],
    });
    const legacy = parseSession(exportSession(ladder(1, [1000, 60000])));
    expect(legacy.sessionVersion).toBe(1);
    expect(legacy.options.steps).toEqual([1000, 60000]);
    expect(replay(legacy).options).toMatchObject({ steps: [1000, 60000] });
    expect(parseSession(exportSession(ladder(1))).options.steps).toEqual([1000, 5000, 10000, 30000, 60000]);
    const current = parseSession(exportSession(ladder(2)));
    expect(current.sessionVersion).toBe(2);
    expect(current.options.steps).toEqual([1000, 5000, 10000, 20000, 30000]);
    expect(() => exportSession(ladder(2, [1000, 60000]))).toThrow();
    expect(() => validateSession({ ...ladder(2), sessionVersion: 3 })).toThrow();
  });
  it("writes the version 2 additions only when they differ from their defaults", () => {
    const base = { ...bullseyeSession(), sessionVersion: 2 as const, actions: [] };
    const hl = (options: Session["options"]): Session => ({ ...base, mode: "higherLower", options });
    expect(JSON.parse(exportSession(hl({}))).options).toEqual({ cards: 10 });
    expect(JSON.parse(exportSession(hl({ play: "everyone" }))).options).toEqual({ cards: 10, play: "everyone", lives: 3 });
    expect(JSON.parse(exportSession(hl({ closer: true }))).options).toEqual({ cards: 10, closer: true });
    const ladder = (options: Session["options"]): Session => ({ ...base, mode: "ladder", options });
    expect(JSON.parse(exportSession(ladder({ rounds: 1 }))).options).not.toHaveProperty("buzzer");
    expect(JSON.parse(exportSession(ladder({ rounds: 1, buzzer: true }))).options.buzzer).toBe(true);
  });
  it("refuses a session that does not replay", () => {
    const session = bullseyeSession();
    session.actions.pop();
    session.actions.push({ type: "draw", at: 60, card: card("c2", 1990, "zine") });
    expect(() => exportSession(session)).toThrow();
  });
});

describe("applyAction", () => {
  it("never changes the caller's state", () => {
    const session = bullseyeSession();
    let state = startGame(session);
    for (const [index, action] of session.actions.entries()) {
      const before = structuredClone(state);
      const next = applyAction(state, action, index);
      expect(state).toEqual(before);
      expect(next).not.toBe(state);
      state = next;
    }
    expect(summarize(state)).toEqual(summarize(replay(session)));
    expect(summarize(state).scores).toEqual({ p1: 17, p2: 5 });
    expect(usedCardIds(state)).toEqual(["c1"]);
  });
  it("leaves the state unchanged when an action is rejected", () => {
    const session = bullseyeSession();
    const state = applyAction(startGame(session), session.actions[0], 0);
    const before = structuredClone(state);
    expect(() =>
      applyAction(state, { type: "guess", at: 5, playerId: "p1", year: 1849 }, 1),
    ).toThrow();
    expect(state).toEqual(before);
  });
});
