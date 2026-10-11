import type { Card } from "./deck";

const MAX_URL_CODE_POINTS = 2048;
const FORBIDDEN_CODE_POINT = /[\p{Cc}\p{Cf}\p{Z}]/u;
const AUTHORITY = /^[^[\]<>^|%"`{}@:]+(?::([0-9]*))?$/u;

// Conceptual boundary from SongSeeker: QR parsing and song resolution are separate.
// A recognized URL shape proves neither catalogue membership nor playback support.
// Rules follow contract/README.md exactly; no platform URL parser is involved.
function authorityOf(value: string): string {
  return value.slice(8).split(/[/?#]/u)[0];
}
export function isSafeHTTPS(value: string): boolean {
  if (
    !value.startsWith("https://") ||
    [...value].length > MAX_URL_CODE_POINTS ||
    value.includes("\\") ||
    FORBIDDEN_CODE_POINT.test(value)
  )
    return false;
  const match = AUTHORITY.exec(authorityOf(value));
  if (!match) return false;
  const port = match[1];
  return !port || Number(port) === 443;
}
export function isOfficialCardURL(value: string): boolean {
  if (!isSafeHTTPS(value)) return false;
  const authority = authorityOf(value);
  if (authority.includes(":") || value.includes("?") || value.includes("#"))
    return false;
  const host = authority.toLowerCase();
  const path = value.slice(8 + authority.length);
  if (host === "hitstergame.com" || host === "www.hitstergame.com")
    return /^\/[A-Za-z]{2}\/(?:[A-Za-z]{4}[0-9]{4}\/)?[0-9]{5}$/u.test(path);
  if (host === "uqr.to") return /^\/[A-Za-z0-9]{1,5}$/u.test(path);
  return (
    host === "app.hitsternordics.com" &&
    /^\/resources\/songs\/[0-9]{1,5}$/u.test(path)
  );
}
// Eratic card route (game-rules.md section 8.2): identifies a deck and card, not a provider.
// A configured host is valid when https://<host>/ is a safe HTTPS URL and the
// host contains none of ":", "/", "?" or "#".
export function isValidEraticHost(host: string): boolean {
  return isSafeHTTPS(`https://${host}/`) && !/[:/?#]/u.test(host);
}
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
// Nothing when the host is invalid or either ID fails the deck ID pattern.
export function eraticCardURL(
  host: string,
  deckId: string,
  cardId: string,
): string | undefined {
  return isValidEraticHost(host) && ID_PATTERN.test(deckId) && ID_PATTERN.test(cardId)
    ? `https://${host}/c/${deckId}/${cardId}`
    : undefined;
}
export type QRMode = "official" | "directLink" | "eraticCard";
export function qrPayload(
  card: Card,
  mode: QRMode,
  linkIndex = 0,
  eratic?: { host: string; deckId: string },
): string | undefined {
  if (mode === "eraticCard")
    return eratic && eraticCardURL(eratic.host, eratic.deckId, card.id);
  if (mode === "official")
    return card.officialCard && isOfficialCardURL(card.officialCard.url)
      ? card.officialCard.url
      : undefined;
  const link = card.links[linkIndex];
  return link && isSafeHTTPS(link.url) ? link.url : undefined;
}
