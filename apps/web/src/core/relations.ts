import type { Card } from "./deck";
import { compareCodePoints } from "./random";

// Linked-recording suggestions (contract/game-rules.md section 8.3): proposals
// of relatedTo links for the host to review, never curated facts.
const VERSION_WORDS = new Set([
  "remaster",
  "remastered",
  "live",
  "version",
  "edit",
  "mix",
  "remix",
  "mono",
  "stereo",
  "demo",
  "acoustic",
  "single",
  "radio",
  "feat",
  "ft",
]);
const namesVersion = (part: string): boolean =>
  (part.match(/[a-z]+/gu) ?? []).some((word) => VERSION_WORDS.has(word));
const OPENERS: Record<string, string> = { ")": "(", "]": "[" };

// Section 8.3: each code point lowercased on its own (no context, so Σ is always σ),
// combining marks removed, then trailing version groups or " - " parts stripped, a
// group first and else the part after the last " - ", until nothing changes.
export function songKey(text: string): string {
  let key = Array.from(text, (char) => char.toLowerCase())
    .join("")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  for (;;) {
    key = key.replace(/ +$/u, "");
    const opener = OPENERS[key.at(-1) ?? ""];
    const open = opener === undefined ? -1 : key.lastIndexOf(opener);
    if (open >= 0 && namesVersion(key.slice(open))) {
      key = key.slice(0, open);
      continue;
    }
    const dash = key.lastIndexOf(" - ");
    if (dash >= 0 && namesVersion(key.slice(dash + 3))) {
      key = key.slice(0, dash);
      continue;
    }
    break;
  }
  return key.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export interface RelationSuggestion {
  cardId: string;
  relatedTo: string;
  relation: "coverOf" | "remasterOf";
}
type SuggestCard = Pick<Card, "id" | "title" | "artist" | "relatedTo"> & {
  gameYear: Pick<Card["gameYear"], "value">;
};
export function suggestRelations(cards: readonly SuggestCard[]): RelationSuggestion[] {
  const groups = new Map<string, SuggestCard[]>();
  for (const card of cards) {
    const key = songKey(card.title);
    if (key === "") continue;
    const group = groups.get(key);
    if (group) group.push(card);
    else groups.set(key, [card]);
  }
  const suggestions: RelationSuggestion[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const original = group.reduce((best, card) =>
      card.gameYear.value < best.gameYear.value ||
      (card.gameYear.value === best.gameYear.value && compareCodePoints(card.id, best.id) < 0)
        ? card
        : best,
    );
    const artist = songKey(original.artist);
    for (const card of group)
      if (card !== original && !card.relatedTo)
        suggestions.push({
          cardId: card.id,
          relatedTo: original.id,
          relation: songKey(card.artist) === artist ? "remasterOf" : "coverOf",
        });
  }
  return suggestions.sort(
    (x, y) =>
      compareCodePoints(x.relatedTo, y.relatedTo) || compareCodePoints(x.cardId, y.cardId),
  );
}
