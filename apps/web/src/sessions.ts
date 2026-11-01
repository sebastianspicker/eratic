import { exportDeck, parseDeck, type Deck } from "./core/deck";
import { exportSession, parseSession, type Session } from "./core/session";
import { dailyStreak, isValidDate } from "./core/scoring";
import { defaultStorage, quarantine as keepAside, readable } from "./storage";

// The current game in localStorage, with the same quarantine rule as decks
// (storage.ts): an unreadable value is copied aside before anything can overwrite it.
export const SESSION_KEY = "eratic.session.v1";
export const SESSION_UNREADABLE_KEY = "eratic.session.v1.unreadable";
export const DAILY_KEY = "eratic.daily.v1";
export class UnreadableSessionSlotError extends Error {}

const isReadable = (raw: string): boolean => readable(parseSession, raw);
const quarantine = (storage: Storage, raw: string): boolean => keepAside(storage, SESSION_UNREADABLE_KEY, raw);
// The value this tab wrote last: it was valid when written, so a save needn't replay it again.
let lastWritten: string | undefined;

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
  if (current !== null && current !== lastWritten && !isReadable(current) && !quarantine(storage, current))
    throw new UnreadableSessionSlotError(
      "Browser storage holds an unreadable saved game, and another one is already kept aside. Download or discard it first; this game is not being saved.",
    );
  storage.setItem(SESSION_KEY, json);
  lastWritten = json;
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
export interface DailyResult {
  score: number;
  shareText?: string;
}
// One streak per device; lastScore, deckId and shareText are the latest game, and
// played holds every deck's result on lastDate (records written before it have none).
export interface DailyRecord {
  lastDate: string;
  streak: number;
  lastScore: number;
  deckId: string;
  shareText?: string;
  played?: Record<string, DailyResult>;
}
const isResult = (value: unknown): value is DailyResult =>
  typeof value === "object" &&
  value !== null &&
  Number.isInteger((value as DailyResult).score) &&
  ((value as DailyResult).shareText === undefined || typeof (value as DailyResult).shareText === "string");
// This deck's result on date, if it was played that day.
export function dailyResult(record: DailyRecord | undefined, date: string, deckId: string): DailyResult | undefined {
  if (record?.lastDate !== date) return undefined;
  if (record.played && Object.hasOwn(record.played, deckId)) return record.played[deckId];
  return record.deckId === deckId
    ? { score: record.lastScore, ...(record.shareText !== undefined && { shareText: record.shareText }) }
    : undefined;
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
    ) {
      // A malformed played map is dropped; the streak still counts.
      const played =
        value.played && typeof value.played === "object" && !Array.isArray(value.played) &&
        Object.values(value.played).every(isResult)
          ? value.played
          : undefined;
      return {
        lastDate: value.lastDate,
        streak: value.streak as number,
        lastScore: value.lastScore as number,
        deckId: value.deckId,
        ...(value.shareText !== undefined && { shareText: value.shareText }),
        ...(played && { played }),
      };
    }
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
  // Other decks played the same day stay played; an older record's own game counts too.
  const sameDay: Record<string, DailyResult> = {};
  if (previous?.lastDate === date)
    for (const id of new Set([previous.deckId, ...Object.keys(previous.played ?? {})]))
      sameDay[id] = dailyResult(previous, date, id)!;
  const record: DailyRecord = {
    lastDate: date,
    streak: dailyStreak(previous, date),
    lastScore: score,
    deckId,
    ...(shareText !== undefined && { shareText }),
    played: { ...sameDay, [deckId]: { score, ...(shareText !== undefined && { shareText }) } },
  };
  try {
    storage?.setItem(DAILY_KEY, JSON.stringify(record));
  } catch {
    // storage full or blocked: the streak is simply not remembered
  }
  return record;
}

// Per-game UI preferences that the session file doesn't hold (easy cards only,
// the card source, Kids' larger controls), so Resume keeps them. Only the current game can be resumed,
// so only its entry is kept. A corrupt value counts as absent.
export const PLAY_PREFS_KEY = "eratic.play.prefs.v1";
export interface PlayPrefs {
  easyOnly: boolean;
  source: "scan" | "draw";
  // Optional: values stored before Kids' larger controls have no such field.
  kids?: boolean;
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
      return { easyOnly: prefs.easyOnly, source: prefs.source, ...(prefs.kids === true && { kids: true }) };
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

// The ID of a finished game whose results the host has not left yet, so a reload
// offers them again ("Results waiting"). Same key and meaning as the Apple app.
export const UNSEEN_KEY = "eratic.play.unseen.v1";
export function loadUnseen(storage = defaultStorage()): string | null {
  try {
    return storage?.getItem(UNSEEN_KEY) ?? null;
  } catch {
    return null;
  }
}
// Unavailable storage only means the results are not offered after a reload.
export function markUnseen(sessionId: string | null, storage = defaultStorage()): void {
  try {
    if (sessionId === null) storage?.removeItem(UNSEEN_KEY);
    else storage?.setItem(UNSEEN_KEY, sessionId);
  } catch {
    // storage full or blocked
  }
}

// The player names of the last non-Daily game, so the next Setup starts with
// the same room. 1-10 trimmed names of 1-40 code points; anything else counts
// as absent.
export const ROSTER_KEY = "eratic.roster.v1";
export function loadRoster(storage = defaultStorage()): string[] | undefined {
  try {
    const value = JSON.parse(storage?.getItem(ROSTER_KEY) ?? "null") as unknown;
    if (!Array.isArray(value) || value.length < 1 || value.length > 10) return undefined;
    for (const name of value) {
      if (typeof name !== "string" || name !== name.trim()) return undefined;
      const length = [...name].length;
      if (length < 1 || length > 40) return undefined;
    }
    return value as string[];
  } catch {
    // corrupt or unavailable
  }
  return undefined;
}
// False when the names could not be stored; the next Setup then uses the defaults.
export function saveRoster(names: readonly string[], storage = defaultStorage()): boolean {
  try {
    const trimmed = names.map((name) => name.trim());
    if (!storage || trimmed.length < 1 || trimmed.length > 10) return false;
    if (trimmed.some((name) => [...name].length < 1 || [...name].length > 40)) return false;
    storage.setItem(ROSTER_KEY, JSON.stringify(trimmed));
    return true;
  } catch {
    return false;
  }
}

// How Bullseye and Era Sort take entries: one player at a time ("each", the
// default) or every player's field on one form ("all"). Remembered per device;
// a corrupt value counts as "each".
export const ENTRY_KEY = "eratic.play.entry.v1";
export type EntryStyle = "each" | "all";
export function loadEntryStyle(storage = defaultStorage()): EntryStyle {
  try {
    return JSON.parse(storage?.getItem(ENTRY_KEY) ?? "null") === "all" ? "all" : "each";
  } catch {
    return "each";
  }
}
export function saveEntryStyle(style: EntryStyle, storage = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(ENTRY_KEY, JSON.stringify(style));
    return true;
  } catch {
    return false;
  }
}

// The deck a game started with, so Resume can play its cards when another deck
// is open. An unreadable value is kept aside like an unreadable session.
export const SESSION_DECK_KEY = "eratic.session.v1.deck";
export const SESSION_DECK_UNREADABLE_KEY = "eratic.session.v1.deck.unreadable";
const quarantineDeck = (storage: Storage, raw: string): boolean =>
  keepAside(storage, SESSION_DECK_UNREADABLE_KEY, raw);
// Best effort: a failure only means Resume needs the deck to be open.
export function persistSessionDeck(deck: Deck, storage = defaultStorage()): void {
  try {
    if (!storage) return;
    const json = exportDeck(deck);
    const current = storage.getItem(SESSION_DECK_KEY);
    if (current !== null && current !== json) {
      // The previous game's own copy goes first, so it can never match the new game
      // (by deck ID) if this write fails; that also frees its space for the write.
      if (readable(parseDeck, current)) storage.removeItem(SESSION_DECK_KEY);
      else if (!quarantineDeck(storage, current)) return;
    }
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
