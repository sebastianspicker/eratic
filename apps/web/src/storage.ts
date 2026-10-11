import { demoDeck, exportDeck, parseDeck, type Deck } from "./core/deck";
export const STORAGE_KEY = "qr-song-quiz.deck.v1";
export const UNREADABLE_KEY = "qr-song-quiz.deck.v1.unreadable";
export class UnreadableSlotError extends Error {}

function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}
function isReadable(raw: string): boolean {
  try {
    parseDeck(raw);
    return true;
  } catch {
    return false;
  }
}
// Keep an unreadable value in its own slot so it is never destroyed; false if
// the slot already holds something else.
function quarantine(storage: Storage, raw: string): boolean {
  const held = storage.getItem(UNREADABLE_KEY);
  if (held === raw) return true;
  if (held !== null) return false;
  storage.setItem(UNREADABLE_KEY, raw);
  return true;
}
export function readUnreadable(storage = defaultStorage()): string | null {
  try {
    return storage?.getItem(UNREADABLE_KEY) ?? null;
  } catch {
    return null;
  }
}
// The main key may still hold the same unreadable value that was quarantined;
// discarding removes it too, so it does not reappear on the next save.
export function discardUnreadable(storage = defaultStorage()): void {
  if (!storage) return;
  const held = storage.getItem(UNREADABLE_KEY);
  if (held !== null && storage.getItem(STORAGE_KEY) === held)
    storage.removeItem(STORAGE_KEY);
  storage.removeItem(UNREADABLE_KEY);
}
export function loadDeck(storage = defaultStorage()): {
  deck: Deck;
  notice: string;
  persisted: boolean;
  unreadable: boolean;
} {
  try {
    const saved = storage?.getItem(STORAGE_KEY) ?? null;
    if (saved === null)
      return {
        deck: demoDeck(),
        notice: "",
        persisted: false,
        unreadable: readUnreadable(storage) !== null,
      };
    try {
      return {
        deck: parseDeck(saved),
        notice: "",
        persisted: true,
        unreadable: readUnreadable(storage) !== null,
      };
    } catch {
      let kept = false;
      try {
        kept = quarantine(storage!, saved);
      } catch {
        // Storage is read-only or full; the main key is still untouched.
      }
      return {
        deck: demoDeck(),
        notice: kept
          ? "The saved deck could not be read. The sample is open; the saved data is kept and can be downloaded."
          : "The saved deck could not be read. The sample is open; the data was left untouched in browser storage, and saving is blocked until the older unreadable data is downloaded or discarded.",
        persisted: false,
        unreadable: readUnreadable(storage) !== null,
      };
    }
  } catch {
    return {
      deck: demoDeck(),
      notice:
        "Saved deck could not be loaded. The sample is open; import a deck to continue.",
      persisted: false,
      unreadable: false,
    };
  }
}
export function persistDeck(deck: Deck, storage = defaultStorage()): void {
  const json = exportDeck(deck);
  if (!storage) throw new Error("Browser storage is unavailable.");
  const current = storage.getItem(STORAGE_KEY);
  if (current !== null && !isReadable(current) && !quarantine(storage, current))
    throw new UnreadableSlotError(
      "Browser storage holds an unreadable saved deck, and a different unreadable deck is already kept. Download or discard the unreadable saved deck first.",
    );
  storage.setItem(STORAGE_KEY, json);
}
