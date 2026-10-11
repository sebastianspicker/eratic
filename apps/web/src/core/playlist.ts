import { isSafeHTTPS } from "./cardUrls";
import {
  assertNoDuplicateNames,
  assertWellFormed,
  MAX_DECK_BYTES,
  validateDeck,
} from "./deck";
import type { Card, Deck, GameYear } from "./deck";
import { candidateV1 } from "./generated/validators.js";
import { APPLE_ID, linkTrack, SPOTIFY_ID, splitURL } from "./scan";

// Playlist review candidates: contract/playlist-candidates.md. A candidate is
// what a provider said about one entry; it never becomes a card without a
// curated year and source (ADR 0004). Fetching belongs to provider adapters.
export type CandidateProvider = "spotify" | "appleMusic";
export interface PlaylistReference {
  provider: CandidateProvider;
  id: string;
  storefront?: string;
}
export type CandidateKind =
  | "track"
  | "local"
  | "unsupported"
  | "missing"
  | "malformed";
export interface Candidate {
  position: number;
  provider: CandidateProvider;
  kind: CandidateKind;
  available?: boolean;
  id?: string;
  url?: string;
  title?: string;
  artist?: string;
  album?: string;
  releaseDate?: string;
  isrc?: string;
}
export type ReviewIssue =
  | "unavailable"
  | "duplicate"
  | "sameIsrc"
  | "inDeck"
  | "sameIsrcInDeck"
  | "noYear"
  | Exclude<CandidateKind, "track">;
export interface ReviewEntry {
  position: number;
  issues: ReviewIssue[];
  duplicateOf?: number;
  sameIsrcAs?: number;
  cardId?: string;
  isrcCardId?: string;
  proposedYear?: number;
}
export interface PromotionDecision {
  gameYear: GameYear;
  title?: string;
  artist?: string;
}
export type PromotionResult =
  | { ok: true; deck: Deck }
  | { ok: false; error: "notTrack" | "inDeck" | "invalid" };

type JSONObject = Record<string, unknown>;
const isObject = (value: unknown): value is JSONObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
// Visible text is the schema's "\S" (contract/README.md).
const isVisible = (value: unknown): value is string =>
  typeof value === "string" && /\S/u.test(value);
const RELEASE_DATE = /^[0-9]{4}(?:-[0-9]{2}(?:-[0-9]{2})?)?$/u;
const ISRC = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/u;
const STOREFRONT = /^[A-Za-z]{2}$/u;
const MAX_START = 1_000_000_000;
const APPLE_SONG_URL =
  /^https:\/\/music\.apple\.com\/[a-z]{2}\/song\/([0-9]{1,15})(?![\s\S])/u;

// Section 3: JSON parsers disagree on duplicates, unpaired surrogates and
// out-of-range numbers, so every page body passes through here. Throws.
export function decodePlaylistPage(bytes: Uint8Array): unknown {
  if (bytes.byteLength > MAX_DECK_BYTES)
    throw new Error("Invalid playlist page: exceeds 8 MiB.");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Invalid playlist page: not valid UTF-8.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid playlist page: not valid JSON (${String(error)}).`);
  }
  assertNoDuplicateNames(text, "playlist page");
  assertWellFormed(value, "playlist page");
  assertRepresentableNumbers(text);
  return value;
}
// JSON.parse turns 1e999 into Infinity and 1e-999 into 0; Swift's JSONDecoder
// rejects both, so the contract does. Scans number tokens outside strings of
// text that is already valid JSON.
function assertRepresentableNumbers(json: string): void {
  const token = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy;
  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (char === '"') {
      i++;
      while (json[i] !== '"') i += json[i] === "\\" ? 2 : 1;
    } else if (char === "-" || (char >= "0" && char <= "9")) {
      token.lastIndex = i;
      const literal = token.exec(json)![0];
      const value = Number(literal);
      const digits = literal.split(/[eE]/u)[0];
      if (!Number.isFinite(value) || (value === 0 && /[1-9]/u.test(digits)))
        throw new Error("Invalid playlist page: a number cannot be represented.");
      i += literal.length - 1;
    }
  }
}

// Section 1.
export function playlistReference(text: string): PlaylistReference | undefined {
  const uri = /^spotify:playlist:([0-9A-Za-z]{22})$/u.exec(text);
  if (uri) return { provider: "spotify", id: uri[1] };
  const url = splitURL(text);
  if (!url) return undefined;
  if (url.host === "open.spotify.com") {
    const match =
      /^(?:\/intl-[A-Za-z-]+)?\/playlist\/([0-9A-Za-z]{22})$/u.exec(url.path);
    return match ? { provider: "spotify", id: match[1] } : undefined;
  }
  if (url.host !== "music.apple.com") return undefined;
  const match =
    /^\/([A-Za-z]{2})\/playlist\/(?:[^/]+\/)?(pl\.[0-9A-Za-z][0-9A-Za-z_-]{0,99})$/u.exec(
      url.path,
    );
  return match
    ? { provider: "appleMusic", id: match[2], storefront: match[1].toLowerCase() }
    : undefined;
}

// Section 2: members are emitted only when present.
function optionalMembers(
  album: unknown,
  releaseDate: unknown,
  isrc: unknown,
): Partial<Candidate> {
  const out: Partial<Candidate> = {};
  if (isVisible(album)) out.album = album;
  if (typeof releaseDate === "string" && RELEASE_DATE.test(releaseDate))
    out.releaseDate = releaseDate;
  if (typeof isrc === "string") {
    const normal = isrc
      .replace(/-/gu, "")
      .replace(/[a-z]/gu, (letter) => letter.toUpperCase());
    if (ISRC.test(normal)) out.isrc = normal;
  }
  return out;
}
function textMember(name: "title" | "artist", value: unknown): Partial<Candidate> {
  return isVisible(value) ? { [name]: value } : {};
}

// Section 3.1.
function spotifyCandidate(item: unknown, position: number): Candidate {
  const bare = (kind: CandidateKind): Candidate => ({
    position,
    provider: "spotify",
    kind,
  });
  if (!isObject(item)) return bare("malformed");
  const t = isObject(item.item)
    ? item.item
    : isObject(item.track)
      ? item.track
      : undefined;
  if (!t) return bare("missing");
  const album = isObject(t.album) ? t.album : {};
  const external = isObject(t.external_ids) ? t.external_ids : {};
  const artist = Array.isArray(t.artists)
    ? t.artists
        .filter(isObject)
        .map((entry) => entry.name)
        .filter(isVisible)
        .join(", ")
    : "";
  const extras = optionalMembers(album.name, album.release_date, external.isrc);
  if (item.is_local === true)
    return {
      ...bare("local"),
      ...textMember("title", t.name),
      ...textMember("artist", artist),
      ...extras,
    };
  if (t.type !== "track") return bare("unsupported");
  if (
    typeof t.id !== "string" ||
    !SPOTIFY_ID.test(t.id) ||
    !isVisible(t.name) ||
    artist === ""
  )
    return bare("malformed");
  return {
    ...bare("track"),
    available: t.is_playable !== false,
    id: t.id,
    url: `https://open.spotify.com/track/${t.id}`,
    title: t.name,
    artist,
    ...extras,
  };
}

// Section 3.2.
function appleCandidate(
  resource: unknown,
  position: number,
  storefront: string,
): Candidate {
  const bare = (kind: CandidateKind): Candidate => ({
    position,
    provider: "appleMusic",
    kind,
  });
  if (!isObject(resource) || typeof resource.type !== "string")
    return bare("malformed");
  if (resource.type !== "songs" && resource.type !== "library-songs")
    return bare("unsupported");
  const a = resource.attributes;
  if (!isObject(a) || !isVisible(a.name) || !isVisible(a.artistName))
    return bare("malformed");
  const extras = optionalMembers(a.albumName, a.releaseDate, a.isrc);
  const common = {
    ...textMember("title", a.name),
    ...textMember("artist", a.artistName),
    ...extras,
  };
  let id: string | undefined;
  let available = true;
  if (resource.type === "songs") {
    if (typeof resource.id !== "string" || !APPLE_ID.test(resource.id))
      return bare("malformed");
    id = resource.id;
    available = isObject(a.playParams);
  } else {
    const catalogId = isObject(a.playParams) ? a.playParams.catalogId : undefined;
    if (typeof catalogId === "string" && APPLE_ID.test(catalogId))
      id = catalogId;
  }
  if (id === undefined) return { ...bare("local"), ...common };
  return {
    ...bare("track"),
    available,
    id,
    url: `https://music.apple.com/${storefront}/song/${id}`,
    ...common,
  };
}

// Section 3: throws when the page as a whole is rejected.
export function normalizePlaylistPage(
  provider: CandidateProvider,
  page: unknown,
  start: number,
  storefront?: string,
): { candidates: Candidate[]; next: string | null } {
  if (!Number.isInteger(start) || start < 0 || start > MAX_START)
    throw new Error("Invalid playlist page: start is out of range.");
  if (!isObject(page)) throw new Error("Invalid playlist page: not an object.");
  if (provider === "spotify") {
    if (!Array.isArray(page.items))
      throw new Error("Invalid playlist page: items is not an array.");
    const next =
      typeof page.next === "string" &&
      page.next.startsWith("https://api.spotify.com/v1/playlists/") &&
      isSafeHTTPS(page.next)
        ? page.next
        : null;
    return {
      candidates: page.items.map((item, k) => spotifyCandidate(item, start + k)),
      next,
    };
  }
  if (storefront === undefined || !STOREFRONT.test(storefront))
    throw new Error("Invalid playlist page: storefront must be two letters.");
  if (!Array.isArray(page.data))
    throw new Error("Invalid playlist page: data is not an array.");
  const lower = storefront.replace(/[A-Z]/gu, (letter) => letter.toLowerCase());
  const absolute =
    typeof page.next === "string" &&
    (page.next.startsWith("/v1/catalog/") ||
      page.next.startsWith("/v1/me/library/playlists/"))
      ? `https://api.music.apple.com${page.next}`
      : undefined;
  return {
    candidates: page.data.map((resource, k) =>
      appleCandidate(resource, start + k, lower),
    ),
    next: absolute !== undefined && isSafeHTTPS(absolute) ? absolute : null,
  };
}

// Section 4.
function proposedYear(candidate: Candidate): number | undefined {
  if (
    candidate.releaseDate === undefined ||
    !/^[0-9]{4}/u.test(candidate.releaseDate)
  )
    return undefined;
  const year = Number(candidate.releaseDate.slice(0, 4));
  return year >= 1850 && year <= 2100 ? year : undefined;
}
// Provider and track ID as one map key; a missing ID is its own key.
const trackKey = (provider: string, id: string | undefined): string =>
  id === undefined ? `${provider}\0-` : `${provider}\0+${id}`;
// The first card in deck order with a link to each track, and with each ISRC.
function indexDeck(deck: { cards: readonly Card[] }) {
  const byTrack = new Map<string, Card>();
  const byIsrc = new Map<string, Card>();
  for (const card of deck.cards) {
    for (const link of card.links) {
      const own = linkTrack(link);
      if (own && !byTrack.has(trackKey(own.provider, own.id)))
        byTrack.set(trackKey(own.provider, own.id), card);
    }
    if (card.isrc !== undefined && !byIsrc.has(card.isrc))
      byIsrc.set(card.isrc, card);
  }
  return { byTrack, byIsrc };
}
export function reviewCandidates(
  candidates: readonly Candidate[],
  deck: { cards: readonly Card[] },
): ReviewEntry[] {
  const { byTrack, byIsrc } = indexDeck(deck);
  // The first earlier `track` candidate (lower index) with each track and ISRC.
  const earlierTrack = new Map<string, Candidate>();
  const earlierIsrc = new Map<string, Candidate>();
  return candidates.map((candidate) => {
    if (candidate.kind !== "track")
      return { position: candidate.position, issues: [candidate.kind] };
    const entry: ReviewEntry = { position: candidate.position, issues: [] };
    if (candidate.available === false) entry.issues.push("unavailable");
    const key = trackKey(candidate.provider, candidate.id);
    const first = earlierTrack.get(key);
    if (first) {
      entry.issues.push("duplicate");
      entry.duplicateOf = first.position;
    } else if (candidate.isrc !== undefined) {
      const same = earlierIsrc.get(candidate.isrc);
      if (same) {
        entry.issues.push("sameIsrc");
        entry.sameIsrcAs = same.position;
      }
    }
    if (!first) earlierTrack.set(key, candidate);
    if (candidate.isrc !== undefined && !earlierIsrc.has(candidate.isrc))
      earlierIsrc.set(candidate.isrc, candidate);
    const card =
      candidate.id === undefined ? undefined : byTrack.get(key);
    if (card) {
      entry.issues.push("inDeck");
      entry.cardId = card.id;
    } else if (candidate.isrc !== undefined) {
      const same = byIsrc.get(candidate.isrc);
      if (same) {
        entry.issues.push("sameIsrcInDeck");
        entry.isrcCardId = same.id;
      }
    }
    const year = proposedYear(candidate);
    if (year === undefined) entry.issues.push("noYear");
    else entry.proposedYear = year;
    return entry;
  });
}

// Section 5, step 2: a candidate normalizePlaylistPage could have produced.
// Candidates may come back from storage, so the card's link is never taken on trust.
function isPromotable(candidate: Candidate): boolean {
  if (!candidateV1(candidate)) return false;
  const { id, url } = candidate;
  if (id === undefined || url === undefined) return false;
  if (candidate.provider === "spotify")
    return SPOTIFY_ID.test(id) && url === `https://open.spotify.com/track/${id}`;
  return APPLE_ID.test(id) && APPLE_SONG_URL.exec(url)?.[1] === id;
}
// Section 5.
export function promoteCandidate(
  deck: Deck,
  candidate: Candidate,
  decision: PromotionDecision,
): PromotionResult {
  if (candidate.kind !== "track") return { ok: false, error: "notTrack" };
  if (!isPromotable(candidate)) return { ok: false, error: "invalid" };
  const { byTrack } = indexDeck(deck);
  if (byTrack.has(trackKey(candidate.provider, candidate.id)))
    return { ok: false, error: "inDeck" };
  const base = `${candidate.provider === "spotify" ? "sp" : "am"}-${candidate.id}`;
  const taken = new Set(deck.cards.map((card) => card.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  const card: Card = {
    id,
    title: decision.title ?? candidate.title ?? "",
    artist: decision.artist ?? candidate.artist ?? "",
    gameYear: decision.gameYear,
    ...(candidate.isrc !== undefined ? { isrc: candidate.isrc } : {}),
    links: [
      {
        provider: candidate.provider,
        url: candidate.url ?? "",
        id: candidate.id,
        ...(candidate.releaseDate !== undefined
          ? { releaseDate: candidate.releaseDate }
          : {}),
      },
    ],
  };
  try {
    return { ok: true, deck: validateDeck({ ...deck, cards: [...deck.cards, card] }) };
  } catch {
    return { ok: false, error: "invalid" };
  }
}
