import { exportDeck, parseDeck, type Deck } from "./core/deck";
import { exportSession, parseSession, type Session } from "./core/session";
import { dailyStreak, isValidDate } from "./core/scoring";

// The current game in localStorage, with the same quarantine rule as decks
// (storage.ts): an unreadable value is copied aside before anything can overwrite it.
export const SESSION_KEY = "eratic.session.v1";
export const SESSION_UNREADABLE_KEY = "eratic.session.v1.unreadable";
export const DAILY_KEY = "eratic.daily.v1";
export class UnreadableSessionSlotError extends Error {}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
function isReadable(raw: string): boolean {
  try {
    parseSession(raw);
    return true;
  } catch {
    return false;
  }
}
// False if the quarantine slot already holds a different value.
function quarantine(storage: Storage, raw: string): boolean {
  const held = storage.getItem(SESSION_UNREADABLE_KEY);
  if (held === raw) return true;
  if (held !== null) return false;
  storage.setItem(SESSION_UNREADABLE_KEY, raw);
  return true;
}

export function loadSession(storage = defaultStorage()): {
  session?: Session;
  unreadable: boolean;
  notice: string;
} {
  try {
    const raw = storage?.getItem(SESSION_KEY) ?? null;
    if (raw !== null)
      try {
        return {
          session: parseSession(raw),
          unreadable: readUnreadableSession(storage) !== null,
          notice: "",
        };
      } catch {
        let kept = false;
        try {
          kept = quarantine(storage!, raw);
        } catch {
          // read-only or full: the main key is still untouched
        }
        return {
          unreadable: readUnreadableSession(storage) !== null,
          notice: kept
            ? "A saved game could not be read. It is kept aside and can be downloaded."
            : "A saved game could not be read. It was left untouched; new games can't be saved until the older unreadable game is downloaded or discarded.",
        };
      }
    return { unreadable: readUnreadableSession(storage) !== null, notice: "" };
  } catch {
    return { unreadable: false, notice: "" };
  }
}
export function persistSession(session: Session, storage = defaultStorage()): void {
  const json = exportSession(session);
  if (!storage) throw new Error("Browser storage is unavailable.");
  const current = storage.getItem(SESSION_KEY);
  if (current !== null && !isReadable(current) && !quarantine(storage, current))
    throw new UnreadableSessionSlotError(
      "Browser storage holds an unreadable saved game, and another one is already kept aside. Download or discard it first; this game is not being saved.",
    );
  storage.setItem(SESSION_KEY, json);
}
// Forgets the saved game; an unreadable value is never removed without a copy.
// False when a saved game is still there afterwards.
export function clearSession(storage = defaultStorage()): boolean {
  try {
    const current = storage?.getItem(SESSION_KEY) ?? null;
    if (current === null) return true;
    if (!isReadable(current) && !quarantine(storage!, current)) return false;
    storage!.removeItem(SESSION_KEY);
    return storage!.getItem(SESSION_KEY) === null;
  } catch {
    // storage unavailable
    return false;
  }
}
export function readUnreadableSession(storage = defaultStorage()): string | null {
  try {
    return storage?.getItem(SESSION_UNREADABLE_KEY) ?? null;
  } catch {
    return null;
  }
}
export function discardUnreadableSession(storage = defaultStorage()): void {
  if (!storage) return;
  const held = storage.getItem(SESSION_UNREADABLE_KEY);
  if (held !== null && storage.getItem(SESSION_KEY) === held)
    storage.removeItem(SESSION_KEY);
  storage.removeItem(SESSION_UNREADABLE_KEY);
}

// Daily Eratic: the last day played and the streak (game-rules.md section 6.8).
export interface DailyRecord {
  lastDate: string;
  streak: number;
  lastScore: number;
  deckId: string;
  shareText?: string;
}
// A corrupt record counts as absent.
export function loadDaily(storage = defaultStorage()): DailyRecord | undefined {
  try {
    const value = JSON.parse(storage?.getItem(DAILY_KEY) ?? "null") as Partial<DailyRecord> | null;
    if (
      value &&
      typeof value === "object" &&
      typeof value.lastDate === "string" &&
      isValidDate(value.lastDate) &&
      Number.isInteger(value.streak) &&
      (value.streak as number) >= 1 &&
      Number.isInteger(value.lastScore) &&
      typeof value.deckId === "string" &&
      (value.shareText === undefined || typeof value.shareText === "string")
    )
      return {
        lastDate: value.lastDate,
        streak: value.streak as number,
        lastScore: value.lastScore as number,
        deckId: value.deckId,
        ...(value.shareText !== undefined && { shareText: value.shareText }),
      };
  } catch {
    // corrupt or unavailable
  }
  return undefined;
}
export function recordDaily(
  date: string,
  score: number,
  deckId: string,
  shareText: string | undefined,
  storage = defaultStorage(),
): DailyRecord {
  const previous = loadDaily(storage);
  const record: DailyRecord = {
    lastDate: date,
    streak: dailyStreak(previous, date),
    lastScore: score,
    deckId,
    ...(shareText !== undefined && { shareText }),
  };
  try {
    storage?.setItem(DAILY_KEY, JSON.stringify(record));
  } catch {
    // storage full or blocked: the streak is simply not remembered
  }
  return record;
}

// Per-game UI preferences that the session file doesn't hold (easy cards only,
// the card source), so Resume keeps them. Only the current game can be resumed,
// so only its entry is kept. A corrupt value counts as absent.
export const PLAY_PREFS_KEY = "eratic.play.prefs.v1";
export interface PlayPrefs {
  easyOnly: boolean;
  source: "scan" | "draw";
}
export function loadPlayPrefs(sessionId: string, storage = defaultStorage()): PlayPrefs | undefined {
  try {
    const value = JSON.parse(storage?.getItem(PLAY_PREFS_KEY) ?? "null") as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, sessionId))
      return undefined;
    const prefs = (value as Record<string, Partial<PlayPrefs> | null>)[sessionId];
    if (
      prefs &&
      typeof prefs === "object" &&
      typeof prefs.easyOnly === "boolean" &&
      (prefs.source === "scan" || prefs.source === "draw")
    )
      return { easyOnly: prefs.easyOnly, source: prefs.source };
  } catch {
    // corrupt or unavailable
  }
  return undefined;
}
// False when the preferences could not be stored; Resume then falls back to the defaults.
export function savePlayPrefs(sessionId: string, prefs: PlayPrefs, storage = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PLAY_PREFS_KEY, JSON.stringify({ [sessionId]: prefs }));
    return true;
  } catch {
    return false;
  }
}

// The deck a game started with, so Resume can play its cards when another deck
// is open. An unreadable value is kept aside like an unreadable session.
export const SESSION_DECK_KEY = "eratic.session.v1.deck";
export const SESSION_DECK_UNREADABLE_KEY = "eratic.session.v1.deck.unreadable";
function quarantineDeck(storage: Storage, raw: string): boolean {
  const held = storage.getItem(SESSION_DECK_UNREADABLE_KEY);
  if (held === raw) return true;
  if (held !== null) return false;
  storage.setItem(SESSION_DECK_UNREADABLE_KEY, raw);
  return true;
}
function isReadableDeck(raw: string): boolean {
  try {
    parseDeck(raw);
    return true;
  } catch {
    return false;
  }
}
// Best effort: a failure only means Resume needs the deck to be open.
export function persistSessionDeck(deck: Deck, storage = defaultStorage()): void {
  try {
    if (!storage) return;
    const json = exportDeck(deck);
    const current = storage.getItem(SESSION_DECK_KEY);
    if (current !== null && current !== json && !isReadableDeck(current) && !quarantineDeck(storage, current))
      return;
    storage.setItem(SESSION_DECK_KEY, json);
  } catch {
    // storage full or blocked
  }
}
export function loadSessionDeck(storage = defaultStorage()): Deck | undefined {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SESSION_DECK_KEY) ?? null;
    if (raw === null) return undefined;
    return parseDeck(raw);
  } catch {
    try {
      if (raw !== null) quarantineDeck(storage!, raw);
    } catch {
      // read-only or full: the slot is left untouched
    }
    return undefined;
  }
}
