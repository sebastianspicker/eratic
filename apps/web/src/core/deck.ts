import { deckV1 as validateSchema, deckV2 as validateSchemaV2 } from "./generated/validators.js";
import fixture from "../../../../contract/demo-deck.json";
import { isOfficialCardURL, isSafeHTTPS } from "./cardUrls";

export interface ProviderLink {
  provider: "spotify" | "appleMusic" | "youtube" | "other";
  url: string;
  id?: string;
  releaseDate?: string;
}
export interface GameYear {
  value: number;
  source: string;
  note?: string;
}
export interface Card {
  id: string;
  title: string;
  artist: string;
  gameYear: GameYear;
  recordingVersion?: string;
  isrc?: string;
  links: ProviderLink[];
  officialCard?: { url: string; notes?: string };
  // Version 2 only (game-rules.md section 8.3).
  clip?: { startMs: number };
  relatedTo?: { cardId: string; relation: "originalOf" | "coverOf" | "remasterOf" };
  difficulty?: number;
}
export interface Deck {
  schemaVersion: 1 | 2;
  id: string;
  title: string;
  defaultClipStartMs?: number;
  cards: Card[];
}

export function assertWellFormed(value: unknown, what = "deck"): void {
  if (typeof value === "string") {
    // With the u flag only unpaired surrogates match; works without ES2024 string methods.
    if (/[\uD800-\uDFFF]/u.test(value))
      throw new Error(`Invalid ${what}: text contains unpaired surrogates.`);
  } else if (Array.isArray(value))
    value.forEach((item) => assertWellFormed(item, what));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      assertWellFormed(key, what);
      assertWellFormed(item, what);
    }
}
export function validateDeck(input: unknown): Deck {
  const isV2 =
    typeof input === "object" &&
    input !== null &&
    (input as { schemaVersion?: unknown }).schemaVersion === 2;
  const validate = isV2 ? validateSchemaV2 : validateSchema;
  if (!validate(input)) {
    const first = validate.errors?.[0];
    throw new Error(
      `Invalid deck: ${first?.instancePath || "/"} ${first?.message || `does not match deck-v${isV2 ? 2 : 1}`}.`,
    );
  }
  assertWellFormed(input);
  const ids = new Set<string>();
  for (const card of input.cards) {
    if (ids.has(card.id)) throw new Error(`Duplicate card ID: ${card.id}.`);
    ids.add(card.id);
    if (card.links.some((link) => !isSafeHTTPS(link.url)))
      throw new Error(
        `Unsafe provider URL on ${card.id}. Use HTTPS without credentials or a custom port.`,
      );
    if (card.officialCard && !isOfficialCardURL(card.officialCard.url))
      throw new Error(`Unrecognized official card URL on ${card.id}.`);
  }
  for (const card of input.cards)
    if (
      card.relatedTo &&
      (card.relatedTo.cardId === card.id || !ids.has(card.relatedTo.cardId))
    )
      throw new Error(`Invalid related card on ${card.id}.`);
  return input;
}
// A version-1 deck becomes version 2 with nothing else changed (game-rules.md section 8.3).
export function migrateDeck(deck: Deck): Deck {
  return validateDeck({ ...deck, schemaVersion: 2 });
}
export const MAX_DECK_BYTES = 8 * 1024 * 1024;
function checkJSONSize(json: string): void {
  if (new TextEncoder().encode(json).byteLength > MAX_DECK_BYTES)
    throw new Error(
      "Deck JSON exceeds 8 MiB. Split the collection into smaller decks.",
    );
}
// JSON.parse lets the last duplicate member win; the contract rejects duplicates.
// Scans text that is already valid JSON, comparing names after unescaping.
export function assertNoDuplicateNames(json: string, what = "deck"): void {
  const stack: ({ names: Set<string>; expectName: boolean } | null)[] = [];
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (char === "{") stack.push({ names: new Set(), expectName: true });
    else if (char === "[") stack.push(null);
    else if (char === "}" || char === "]") stack.pop();
    else if (char === ",") {
      const top = stack[stack.length - 1];
      if (top) top.expectName = true;
    } else if (char === '"') {
      let end = i + 1;
      while (json[end] !== '"') end += json[end] === "\\" ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top?.expectName) {
        const name = JSON.parse(json.slice(i, end + 1)) as string;
        if (top.names.has(name))
          throw new Error(`Invalid ${what}: duplicate member name "${name}".`);
        top.names.add(name);
        top.expectName = false;
      }
      i = end;
    }
  }
}
export function parseDeck(json: string): Deck {
  checkJSONSize(json);
  const value = JSON.parse(json) as unknown;
  assertNoDuplicateNames(json);
  return validateDeck(value);
}
// Deck files are strict UTF-8 (a leading BOM is ignored). UTF-16/32 either fail
// fatal decoding or leave NULs that JSON.parse rejects.
export function decodeDeckBytes(bytes: Uint8Array): Deck {
  if (bytes.byteLength > MAX_DECK_BYTES)
    throw new Error(
      "Deck JSON exceeds 8 MiB. Split the collection into smaller decks.",
    );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Invalid deck: the file is not valid UTF-8.");
  }
  return parseDeck(text);
}
export function exportDeck(deck: Deck): string {
  const json = `${JSON.stringify(validateDeck(deck), null, 2)}\n`;
  if (new TextEncoder().encode(json).byteLength <= MAX_DECK_BYTES) return json;
  // Compact output keeps a valid imported deck exportable when indentation alone
  // would cross the shared byte limit.
  const compact = JSON.stringify(deck);
  checkJSONSize(compact);
  return compact;
}
export function demoDeck(): Deck {
  return validateDeck(structuredClone(fixture));
}

// JonasScholl/hitster inspired explicit year curation; provider dates remain intact.
export function updateGameYear(
  deck: Deck,
  cardID: string,
  gameYear: GameYear,
): Deck {
  if (!deck.cards.some((card) => card.id === cardID))
    throw new Error(`Unknown card ID: ${cardID}`);
  const updated = {
    ...deck,
    cards: deck.cards.map((card) =>
      card.id === cardID ? { ...card, gameYear } : card,
    ),
  };
  return validateDeck(updated);
}
