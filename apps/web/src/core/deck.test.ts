import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoDuplicateNames,
  decodeDeckBytes,
  demoDeck,
  exportDeck,
  MAX_DECK_BYTES,
  parseDeck,
  updateGameYear,
  validateDeck,
} from "./deck";

describe("updateGameYear", () => {
  it("preserves every optional field through curation and export", () => {
    const deck = demoDeck();
    Object.assign(deck.cards[0], {
      isrc: "USABC2400001",
      officialCard: {
        url: "https://www.hitstergame.com/en/aaaa0001/00001",
        notes: "Supplied, unverified",
      },
    });
    deck.cards[0].links[0].releaseDate = "2024-04-03";
    const updated = updateGameYear(deck, deck.cards[0].id, {
      ...deck.cards[0].gameYear,
      value: 1985,
      source: "Liner notes",
    });
    const expected = structuredClone(deck);
    expected.cards[0].gameYear.value = 1985;
    expected.cards[0].gameYear.source = "Liner notes";
    expect(parseDeck(exportDeck(updated))).toEqual(expected);
  });
  it("rejects an unknown card ID", () => {
    expect(() =>
      updateGameYear(demoDeck(), "missing", { value: 1990, source: "x" }),
    ).toThrow("Unknown card ID: missing");
  });
  it("does not mutate its input", () => {
    const deck = demoDeck();
    const before = structuredClone(deck);
    updateGameYear(deck, "demo-001", { value: 1990, source: "Liner notes" });
    expect(deck).toEqual(before);
  });
  it("rejects invalid curated source/year", () => {
    const deck = demoDeck();
    expect(() =>
      updateGameYear(deck, "demo-001", { value: 1984.5, source: "Liner" }),
    ).toThrow();
    expect(() =>
      updateGameYear(deck, "demo-001", { value: 1984, source: "   " }),
    ).toThrow();
    expect(() =>
      updateGameYear(deck, "demo-001", { value: 1849, source: "Liner" }),
    ).toThrow();
  });
});
describe("deck size boundary", () => {
  it("counts UTF-8 bytes on import, including multibyte text", () => {
    expect(() => parseDeck(" ".repeat(MAX_DECK_BYTES + 1))).toThrow(/8 MiB/);
    expect(() => parseDeck("é".repeat(MAX_DECK_BYTES / 2 + 1))).toThrow(
      /8 MiB/,
    );
  });
  it("exports compact JSON when indentation would exceed the limit", () => {
    const deck = demoDeck();
    const card = deck.cards[0];
    deck.cards = Array.from({ length: 1385 }, (_, index) => ({
      ...card,
      id: `card-${index}`,
      links: [
        {
          provider: "other" as const,
          url: `https://example.com/${"a".repeat(1819)}`,
          id: "b".repeat(500),
          releaseDate: "c".repeat(500),
        },
      ],
    }));
    // Choose enough repeated links to place this valid deck at the pretty/compact boundary.
    for (const item of deck.cards)
      item.links.push(...structuredClone(item.links));
    const compact = JSON.stringify(deck);
    const pretty = JSON.stringify(deck, null, 2);
    expect(new TextEncoder().encode(compact).byteLength).toBeLessThan(
      MAX_DECK_BYTES,
    );
    expect(new TextEncoder().encode(pretty).byteLength).toBeGreaterThan(
      MAX_DECK_BYTES,
    );
    expect(parseDeck(exportDeck(parseDeck(compact)))).toEqual(deck);
  });
  it("rejects a valid but oversized export without losing data", () => {
    const deck = demoDeck();
    const card = deck.cards[0];
    deck.cards = Array.from({ length: 600 }, (_, index) => ({
      ...card,
      id: `card-${index}`,
      links: Array.from({ length: 20 }, () => ({
        provider: "other" as const,
        url: `https://example.com/${"a".repeat(900)}`,
      })),
    }));
    expect(() => exportDeck(deck)).toThrow(/8 MiB/);
    expect(deck.cards).toHaveLength(600);
  });
});
describe("deck card count", () => {
  const withCards = (count: number) => {
    const deck = demoDeck();
    const card = deck.cards[0];
    deck.cards = Array.from({ length: count }, (_, index) => ({
      ...card,
      id: `card-${index}`,
    }));
    return deck;
  };
  it("accepts 2000 cards", () => {
    expect(validateDeck(withCards(2000)).cards).toHaveLength(2000);
  });
  it("rejects 2001 cards", () => {
    expect(() => validateDeck(withCards(2001))).toThrow();
  });
});
describe("duplicate member names", () => {
  it("rejects a duplicate inside an object nested in an array", () => {
    expect(() =>
      assertNoDuplicateNames('{"a":[{"b":1,"c":2,"b":3}]}'),
    ).toThrow(/duplicate/);
  });
  it("allows the same name in sibling objects and as a string value", () => {
    expect(() =>
      assertNoDuplicateNames(
        '{"a":{"x":1},"b":{"x":"x"},"c":["a",{"x":"a"}]}',
      ),
    ).not.toThrow();
  });
  it("compares names after escape decoding", () => {
    expect(() =>
      assertNoDuplicateNames('{"title":1,"ti\\u0074le":2}'),
    ).toThrow(/duplicate/);
    expect(() => assertNoDuplicateNames('{"a\\"b":1,"a\\"b":2}')).toThrow(
      /duplicate/,
    );
  });
  it("is not confused by braces, commas or quotes inside strings", () => {
    expect(() =>
      assertNoDuplicateNames('{"a":"{,\\"a\\":","b":"}"}'),
    ).not.toThrow();
  });
  it("is applied by parseDeck", () => {
    const json = JSON.stringify(demoDeck()).replace(
      '"schemaVersion":1',
      '"schemaVersion":1,"schemaVersion":1',
    );
    expect(() => parseDeck(json)).toThrow(/duplicate/);
  });
});
describe("decodeDeckBytes", () => {
  it("rejects invalid UTF-8 and oversized input", () => {
    expect(() => decodeDeckBytes(new Uint8Array([0x7b, 0xff, 0x7d]))).toThrow(
      /UTF-8/,
    );
    expect(() => decodeDeckBytes(new Uint8Array(MAX_DECK_BYTES + 1))).toThrow(
      /8 MiB/,
    );
  });
  it("ignores a leading BOM", () => {
    const body = new TextEncoder().encode(JSON.stringify(demoDeck()));
    expect(
      decodeDeckBytes(new Uint8Array([0xef, 0xbb, 0xbf, ...body])),
    ).toEqual(demoDeck());
  });
});
describe("well-formed text on engines lacking the ES2024 string check", () => {
  // Remove any built-in well-formedness method (Firefox 114 has none).
  const names = Object.getOwnPropertyNames(String.prototype).filter((name) =>
    /wellformed/i.test(name),
  );
  const saved = names.map(
    (name) => [name, Object.getOwnPropertyDescriptor(String.prototype, name)!] as const,
  );
  afterEach(() => {
    for (const [name, descriptor] of saved)
      Object.defineProperty(String.prototype, name, descriptor);
  });
  it("still rejects unpaired surrogates and accepts astral text", () => {
    for (const name of names) delete (String.prototype as never)[name];
    const deck = demoDeck();
    deck.title = "Pair \u{1F3B5}";
    expect(validateDeck(deck).title).toBe("Pair \u{1F3B5}");
    deck.title = "Lone \uD800";
    expect(() => validateDeck(deck)).toThrow(/surrogate/);
  });
});
