import {
  eraticCardURL,
  isOfficialCardURL,
  isSafeHTTPS,
  isValidEraticHost,
} from "./cardUrls";
import type { Card, ProviderLink } from "./deck";

export { eraticCardURL, isValidEraticHost };

// Provider tracks and scan resolution: contract/game-rules.md section 8.
// A scan only selects a card; it never opens a provider app.
export interface ProviderTrack {
  provider: "spotify" | "appleMusic";
  id: string;
  storefront?: string;
}
export const SPOTIFY_ID = /^[0-9A-Za-z]{22}$/u;
export const APPLE_ID = /^[0-9]{1,15}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

// Hosts compare as exact strings after ASCII-only lowercasing (section 1.1):
// no Unicode case mapping, no canonical equivalence.
const asciiLower = (text: string): string =>
  text.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
// Splits a safe HTTPS URL into host (without a port), path and query.
export function splitURL(
  value: string,
): { host: string; path: string; query: string } | undefined {
  if (!isSafeHTTPS(value)) return undefined;
  const rest = value.slice(8);
  const authority = rest.split(/[/?#]/u)[0];
  const tail = rest.slice(authority.length).split("#")[0];
  const queryAt = tail.indexOf("?");
  return {
    host: asciiLower(authority.split(":")[0]),
    path: queryAt < 0 ? tail : tail.slice(0, queryAt),
    query: queryAt < 0 ? "" : tail.slice(queryAt + 1),
  };
}
export function providerTrack(text: string): ProviderTrack | undefined {
  const uri = /^spotify:track:([0-9A-Za-z]{22})$/u.exec(text);
  if (uri) return { provider: "spotify", id: uri[1] };
  const url = splitURL(text);
  if (!url) return undefined;
  if (url.host === "open.spotify.com") {
    const match = /^(?:\/intl-[A-Za-z-]+)?\/track\/([0-9A-Za-z]{22})$/u.exec(
      url.path,
    );
    return match ? { provider: "spotify", id: match[1] } : undefined;
  }
  if (url.host !== "music.apple.com") return undefined;
  const base = /^\/([A-Za-z]{2})\/(album|song)\/(.+)$/u.exec(url.path);
  if (!base) return undefined;
  const storefront = base[1].toLowerCase();
  const segments = base[3].split("/");
  let id: string | undefined;
  if (base[2] === "album") {
    if (segments.length !== 2 || segments.some((part) => part === ""))
      return undefined;
    const param = url.query
      .split("&")
      .find((item) => item === "i" || item.startsWith("i="));
    id = param?.slice(2);
  } else if (segments.length === 1) id = segments[0];
  else if (segments.length === 2 && segments[0] !== "") id = segments[1];
  return id !== undefined && APPLE_ID.test(id)
    ? { provider: "appleMusic", id, storefront }
    : undefined;
}
export function linkTrack(
  link: Pick<ProviderLink, "provider" | "url" | "id">,
): ProviderTrack | undefined {
  if (link.provider !== "spotify" && link.provider !== "appleMusic")
    return undefined;
  const shape = link.provider === "spotify" ? SPOTIFY_ID : APPLE_ID;
  if (link.id !== undefined && shape.test(link.id))
    return { provider: link.provider, id: link.id };
  const track = providerTrack(link.url);
  return track?.provider === link.provider ? track : undefined;
}

export type ScanResult =
  | { kind: "card"; cardId: string; via: "eraticCard" | "providerLink" | "officialCard" }
  | { kind: "unknownCard"; cardId: string }
  | { kind: "otherDeck"; deckId: string }
  | { kind: "unmatchedProvider"; provider: "spotify" | "appleMusic"; trackId: string }
  | { kind: "unmatchedOfficial" }
  | { kind: "unrecognized" };

export function resolveScan(
  payload: string,
  deck: { id: string; cards: readonly Card[] },
  hosts: readonly string[],
): ScanResult {
  const url = splitURL(payload);
  if (url && hosts.some((host) => asciiLower(host) === url.host)) {
    const route = /^\/c\/([^/]+)\/([^/]+)$/u.exec(url.path);
    if (
      route &&
      !payload.includes("?") &&
      !payload.includes("#") &&
      ID_PATTERN.test(route[1]) &&
      ID_PATTERN.test(route[2])
    ) {
      const [, deckId, cardId] = route;
      if (deckId !== deck.id) return { kind: "otherDeck", deckId };
      return deck.cards.some((card) => card.id === cardId)
        ? { kind: "card", cardId, via: "eraticCard" }
        : { kind: "unknownCard", cardId };
    }
  }
  const exact = deck.cards.find((card) =>
    card.links.some((link) => link.url === payload),
  );
  if (exact) return { kind: "card", cardId: exact.id, via: "providerLink" };
  const track = providerTrack(payload);
  if (track) {
    const match = deck.cards.find((card) =>
      card.links.some((link) => {
        const own = linkTrack(link);
        return own?.provider === track.provider && own.id === track.id;
      }),
    );
    return match
      ? { kind: "card", cardId: match.id, via: "providerLink" }
      : { kind: "unmatchedProvider", provider: track.provider, trackId: track.id };
  }
  const official = deck.cards.find((card) => card.officialCard?.url === payload);
  if (official)
    return { kind: "card", cardId: official.id, via: "officialCard" };
  return isOfficialCardURL(payload)
    ? { kind: "unmatchedOfficial" }
    : { kind: "unrecognized" };
}
