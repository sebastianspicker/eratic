import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { candidateV1 } from "./generated/validators.js";
import {
  decodePlaylistPage,
  normalizePlaylistPage,
  playlistReference,
  promoteCandidate,
  reviewCandidates,
} from "./playlist";
import type { Candidate, PromotionDecision } from "./playlist";
import type { Deck } from "./deck";

// contract/playlist-candidates.md; the same cases run in the Swift core tests.
type Args = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
// JSON.parse, not a bundler import: a `__proto__` member must stay an own member.
const cases = JSON.parse(
  readFileSync(
    new URL("../../../../contract/cases/playlist-candidates.json", import.meta.url),
    "utf8",
  ),
) as Record<string, Args[]>;
const decks = cases.decks as unknown as Record<string, Deck>;
const REJECTED = /^Invalid playlist page: /u;
// Every candidate a case uses must match candidate-v1.schema.json.
const expectCandidates = (list: unknown[]) => {
  for (const candidate of list)
    expect(candidateV1(candidate), JSON.stringify(candidateV1.errors)).toBe(true);
};

describe("playlist references", () => {
  for (const c of cases.references)
    it(c.name, () => {
      expect(playlistReference(c.input) ?? null).toStrictEqual(c.expected);
    });
});

describe("playlist pages", () => {
  for (const c of cases.pages)
    it(c.name, () => {
      // A case gives the decoded `page`, or the exact page text as `json`.
      const run = () =>
        normalizePlaylistPage(
          c.provider,
          c.json === undefined
            ? c.page
            : decodePlaylistPage(new TextEncoder().encode(c.json)),
          c.start,
          c.storefront,
        );
      if (c.expected.error) expect(run).toThrow(REJECTED);
      else {
        const result = run();
        expect(result).toStrictEqual(c.expected);
        expectCandidates(result.candidates);
      }
    });
});

describe("playlist review", () => {
  for (const c of cases.review)
    it(c.name, () => {
      expectCandidates(c.candidates);
      expect(reviewCandidates(c.candidates, decks[c.deck])).toStrictEqual(
        c.expected,
      );
    });
});

describe("playlist promotion", () => {
  for (const c of cases.promotion)
    it(c.name, () => {
      if (!c.schemaInvalid) expectCandidates([c.candidate]);
      const deck = decks[c.deck];
      const before = structuredClone(deck);
      const result = promoteCandidate(
        deck,
        c.candidate as Candidate,
        c.decision as PromotionDecision,
      );
      expect(deck).toStrictEqual(before);
      if (c.expected.error) {
        expect(result).toStrictEqual({ ok: false, error: c.expected.error });
        return;
      }
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.deck.cards).toHaveLength(c.expected.cardCount);
      expect(result.deck.cards.slice(0, -1)).toStrictEqual(before.cards);
      expect(result.deck.cards[result.deck.cards.length - 1]).toStrictEqual(
        c.expected.card,
      );
      expect({ ...result.deck, cards: [] }).toStrictEqual({
        ...before,
        cards: [],
      });
    });
});
