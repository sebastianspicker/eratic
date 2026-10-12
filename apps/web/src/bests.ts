import { normalizeOptions, type Session } from "./core/session";

// Personal bests on this device, per deck and kind of game: Relay's team score, and
// the score of any finished game with exactly one player (except Daily, which has
// its own streak). Unreadable values count as no bests; nothing leaves the device.
export const BESTS_KEY = "eratic.bests.v1";
export interface Best {
  score: number;
  sessionId: string;
}
export type Bests = Record<string, Record<string, Best>>;

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Keeps only well-formed entries; anything corrupt reads as empty.
export function parseBests(raw: string | null): Bests {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? "null");
  } catch {
    return {};
  }
  // Prototype-free, so stored IDs such as "__proto__" stay plain keys.
  const bests: Bests = Object.create(null);
  if (!isObject(value)) return bests;
  for (const [deckId, kinds] of Object.entries(value)) {
    if (!isObject(kinds)) continue;
    for (const [kind, best] of Object.entries(kinds)) {
      if (!isObject(best) || !Number.isFinite(best.score) || typeof best.sessionId !== "string") continue;
      if (!Object.hasOwn(bests, deckId)) bests[deckId] = Object.create(null);
      bests[deckId][kind] = { score: best.score as number, sessionId: best.sessionId };
    }
  }
  return bests;
}
export function loadBests(storage = defaultStorage()): Bests {
  try {
    return parseBests(storage?.getItem(BESTS_KEY) ?? null);
  } catch {
    return {};
  }
}

// The kind a finished game counts as, or none: "relay-<target>-<lives>", or
// "solo-<mode>-<length>" where the length is the game's rounds, cards (Higher or
// Lower), target (Timeline) or k x rounds (Lineup, "4x5"). A game cut short with
// End game (the session's last action is "end") counts as none.
export function bestKind(session: Session): string | undefined {
  if (session.actions.at(-1)?.type === "end") return undefined;
  if (session.mode === "daily" || (session.mode !== "relay" && session.players.length !== 1)) return undefined;
  let options: Record<string, unknown>;
  try {
    options = normalizeOptions(session.mode, session.options, session.sessionVersion) as unknown as Record<string, unknown>;
  } catch {
    return undefined;
  }
  switch (session.mode) {
    case "relay":
      return `relay-${options.target}-${options.lives}`;
    case "higherLower":
      return `solo-higherLower-${options.cards}`;
    case "timeline":
      return `solo-timeline-${options.target}`;
    case "lineup":
      return `solo-lineup-${options.k}x${options.rounds}`;
    default:
      return `solo-${session.mode}-${options.rounds}`;
  }
}

// How this game compares, without writing: the best to show, whether it strictly
// beat a previous best, and whether it should be stored. A game already stored
// (its session ID is the best's) is never counted again.
export function compareBest(
  bests: Bests,
  deckId: string,
  kind: string,
  score: number,
  sessionId: string,
): { best: number; isNew: boolean; store: boolean } {
  const previous = Object.hasOwn(bests, deckId) && Object.hasOwn(bests[deckId], kind) ? bests[deckId][kind] : undefined;
  if (!previous) return { best: score, isNew: false, store: true };
  if (previous.sessionId === sessionId) return { best: previous.score, isNew: false, store: false };
  if (score > previous.score) return { best: score, isNew: true, store: true };
  return { best: previous.score, isNew: false, store: false };
}

// Records the game once per session; false when storage is unavailable.
export function recordBest(
  deckId: string,
  kind: string,
  score: number,
  sessionId: string,
  storage = defaultStorage(),
): boolean {
  try {
    if (!storage) return false;
    const bests = loadBests(storage);
    if (!compareBest(bests, deckId, kind, score, sessionId).store) return true;
    const deck = Object.hasOwn(bests, deckId) ? bests[deckId] : {};
    storage.setItem(BESTS_KEY, JSON.stringify({ ...bests, [deckId]: { ...deck, [kind]: { score, sessionId } } }));
    return true;
  } catch {
    return false;
  }
}
