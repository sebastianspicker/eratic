import { describe, expect, it } from "vitest";
import deckCases from "../../../../contract/cases/deck-validation.json";
import urlCases from "../../../../contract/cases/card-urls.json";
import routeCases from "../../../../contract/cases/qr-routes.json";
import demo from "../../../../contract/demo-deck.json";
import {
  decodeDeckBytes,
  exportDeck,
  parseDeck,
  validateDeck,
  type Card,
} from "./deck";
import { qrPayload, type QRMode } from "./cardUrls";

type DeckCase = {
  name: string;
  valid: boolean;
  deck?: unknown;
  json?: string;
  base64?: string;
};
const deckList = deckCases.cases as DeckCase[];

describe("contract: deck-validation", () => {
  it("has cases", () => expect(deckList.length).toBeGreaterThan(0));
  for (const item of deckList)
    it(item.name, () => {
      const forms = [item.deck, item.json, item.base64].filter(
        (form) => form !== undefined,
      );
      expect(forms, "exactly one of deck, json, base64").toHaveLength(1);
      const run = () => {
        if (item.json !== undefined) return parseDeck(item.json);
        if (item.base64 !== undefined)
          return decodeDeckBytes(
            new Uint8Array(Buffer.from(item.base64, "base64")),
          );
        return validateDeck(structuredClone(item.deck));
      };
      if (!item.valid) return expect(run).toThrow();
      const deck = run();
      expect(parseDeck(exportDeck(deck))).toEqual(deck);
    });
});
describe("contract: card-urls", () => {
  it("has cases", () => expect(urlCases.cases.length).toBeGreaterThan(0));
  for (const item of urlCases.cases)
    it(`${item.role} ${item.valid ? "accepts" : "rejects"} ${JSON.stringify(item.url)}`, () => {
      const deck = structuredClone(demo);
      if (item.role === "providerLink") deck.cards[0].links[0].url = item.url;
      else Object.assign(deck.cards[0], { officialCard: { url: item.url } });
      if (item.valid) expect(() => validateDeck(deck)).not.toThrow();
      else expect(() => validateDeck(deck)).toThrow();
    });
});
describe("contract: qr-routes", () => {
  it("has cases", () => expect(routeCases.cases.length).toBeGreaterThan(0));
  for (const item of routeCases.cases)
    it(item.name, () => {
      const mode = item.mode as QRMode;
      const eratic = "eratic" in item ? item.eratic : undefined;
      expect(qrPayload(item.card as Card, mode, item.linkIndex, eratic)).toBe(
        item.expected ?? undefined,
      );
    });
});
