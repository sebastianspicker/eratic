import { useState } from "react";
import type { Deck } from "../core/deck";
import { suggestRelations, type RelationSuggestion } from "../core/relations";

const RELATION_WORDS: Record<RelationSuggestion["relation"], string> = {
  coverOf: "cover of",
  remasterOf: "remaster of",
};

// Proposed relatedTo links from matching titles (game-rules.md section 8.3). They are
// guesses for the host to check, never applied without Link. Dismissed ones are
// hidden until the page reloads and are not stored.
export function LinkSuggestions({
  deck,
  onLink,
}: {
  deck: Deck;
  // Throws the core's message when the deck would be invalid.
  onLink: (suggestion: RelationSuggestion) => void;
}) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");
  const suggestions = suggestRelations(deck.cards).filter((item) => !dismissed.has(item.cardId));
  if (suggestions.length === 0) return null;
  const byId = new Map(deck.cards.map((card) => [card.id, card]));
  return (
    <details className="link-suggestions">
      <summary>Suggested linked recordings ({suggestions.length})</summary>
      <p className="muted">
        These are suggestions from matching titles. Check each pair before linking: different songs can share a title.
      </p>
      <ul>
        {suggestions.map((item) => {
          const card = byId.get(item.cardId)!;
          const original = byId.get(item.relatedTo)!;
          return (
            <li key={item.cardId}>
              <span>
                {card.title} — {RELATION_WORDS[item.relation]} {original.title} ({original.gameYear.value})
              </span>
              <button
                type="button"
                aria-label={`Link ${card.title}`}
                onClick={() => {
                  try {
                    onLink(item);
                    setError("");
                  } catch (failure) {
                    setError(failure instanceof Error ? failure.message : "Could not link the recordings.");
                  }
                }}
              >
                Link
              </button>
              <button
                type="button"
                aria-label={`Dismiss ${card.title}`}
                onClick={() => setDismissed((current) => new Set(current).add(item.cardId))}
              >
                Dismiss
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </details>
  );
}
