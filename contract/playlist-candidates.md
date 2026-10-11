# Playlist review candidates

A playlist import yields **review candidates**, not deck cards ([ADR 0004](../docs/adr/0004-playlist-import-candidates.md), [design](../docs/playlist-import.md)). A candidate carries what the provider said about one playlist entry. It may lack a usable year, and it never becomes a card until the user supplies a curated year and its source. Both cores implement the functions below and run [cases/playlist-candidates.json](cases/playlist-candidates.json). Fetching, authorization and pagination requests belong to provider adapters beside each core; they pass the pages they receive to `normalizePlaylistPage` unchanged.

Text rules (visible text, safe HTTPS URL, code points) are those of [README.md](README.md). Lowercasing is ASCII only.

## 1. Playlist references

`playlistReference(text)` returns `{provider, id}` (plus `storefront` for Apple Music) or nothing:

- **Spotify:** `spotify:playlist:<id>`, or a safe HTTPS URL whose host is `open.spotify.com` (any case) and whose path is `/playlist/<id>` or `/intl-<tag>/playlist/<id>` (`<tag>` is letters and hyphens). `<id>` is exactly 22 characters of `[0-9A-Za-z]`. A query or fragment is ignored.
- **Apple Music:** a safe HTTPS URL whose host is `music.apple.com` (any case) and whose path is `/<storefront>/playlist/<slug>/<id>` or `/<storefront>/playlist/<id>`, where `<storefront>` is two ASCII letters (returned lowercased), `<slug>` is non-empty and contains no `/`, and `<id>` is `pl.` followed by 1–100 characters of `[0-9A-Za-z_-]`, the first of them a letter or digit. A query or fragment is ignored.

Anything else, including album, artist and personal-library URLs, returns nothing.

## 2. Candidates

A candidate is a JSON object ([candidate-v1.schema.json](candidate-v1.schema.json)):

| Member | When present | Meaning |
| --- | --- | --- |
| `position` | always | 0-based index of the entry in the playlist |
| `provider` | always | `spotify` or `appleMusic` |
| `kind` | always | `track`, `local` (no catalogue identity), `unsupported` (not a song, e.g. a podcast episode or music video), `missing` (the provider sent no item, e.g. a removed track) or `malformed` (an item that breaks the rules below) |
| `available` | `track` only | `false` when the provider says the track cannot be played in the requested market or storefront |
| `id`, `url` | `track` only | Provider track ID and its canonical URL: `https://open.spotify.com/track/<id>` or `https://music.apple.com/<storefront>/song/<id>` |
| `title`, `artist` | `track` (required), `local` (when known) | Provider text, exactly as received |
| `album` | optional, `track` and `local` | Provider album name, shown during review (compilations and remasters carry misleading dates) |
| `releaseDate` | optional, `track` and `local` | Raw provider date matching `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (ASCII digits; month and day are not range-checked) |
| `isrc` | optional, `track` and `local` | The provider ISRC with every `-` removed and ASCII letters uppercased, kept only if it then matches the deck ISRC pattern |

`unsupported`, `missing` and `malformed` candidates carry only `position`, `provider` and `kind`. A string member is used only when it is a JSON string containing visible text; otherwise it counts as absent. Text is never trimmed or truncated.

## 3. Page normalization

`decodePlaylistPage(bytes)` parses a response body under the deck file's JSON text rules ([README.md](README.md): RFC 8259 JSON in UTF-8, a leading byte-order mark ignored, no duplicate member names, well-formed strings, at most 8 MiB) and additionally rejects a number literal that an IEEE 754 double cannot represent: one that rounds to infinity (`1e999`, `1.7976931348623159e308`), or rounds to zero although a digit before its exponent is not zero (`1e-999`, `2e-324`; `3e-324` rounds to the smallest subnormal and is accepted, `0e-999` is zero). JSON parsers disagree on duplicates and unpaired surrogates, so without these rules the two apps would read different candidates from the same response. Adapters pass every page body through it.

`normalizePlaylistPage(provider, page, start, storefront?)` turns one decoded page into `{candidates, next}`. `start` is an integer from 0 through 1000000000, the number of entries already received; the item at index `k` of the page's item array gets `position = start + k`. The page is rejected as a whole (an error) when `start` is out of range, the page is not an object, or its item array is missing or not an array; single bad items become `malformed` candidates and never reject the page. A JSON array never counts as an object.

`next` is the URL of the following page, or `null`. A value that fails the rule below is `null`, so an adapter never sends its authorization to another host.

### 3.1 Spotify

The page is a [Get Playlist Items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items) response (`GET /v1/playlists/{id}/items`). Items are in `items`. `next` is the page's `next` when it is a safe HTTPS URL starting with exactly `https://api.spotify.com/v1/playlists/`. For each item:

1. Not an object: `malformed`.
2. The track object `t` is the item's `item` member when that is an object, else its deprecated `track` member when that is an object. Neither: `missing`.
3. The item's `is_local` is `true`: `local`, with `title` = `t.name`, `artist` and the optional members below where present.
4. `t.type` is not the string `track`: `unsupported`.
5. `t.id` is not 22 characters of `[0-9A-Za-z]`, `t.name` has no visible text, or `artist` is empty: `malformed`.
6. Otherwise `track`: `available` is `false` exactly when `t.is_playable` is the JSON boolean `false`.

`artist` joins, in order and separated by `", "`, the `name` of each object in the array `t.artists` whose `name` has visible text; when `t.artists` is not an array it is empty. `album` is `t.album.name`, `releaseDate` is `t.album.release_date`, and `isrc` comes from `t.external_ids.isrc`.

### 3.2 Apple Music

The page is a playlist tracks response (`GET /v1/catalog/{storefront}/playlists/{id}/tracks`, or `/v1/me/library/playlists/{id}/tracks` for a personal-library playlist). Items are in `data`. `storefront` is required: two ASCII letters, used lowercased, otherwise the page is rejected. `next` is `https://api.music.apple.com` followed by the page's `next` when that is a string starting with `/v1/catalog/` or `/v1/me/library/playlists/` and the result is a safe HTTPS URL. For each resource `r`:

1. Not an object, or `r.type` not a string: `malformed`.
2. `r.type` is neither `songs` nor `library-songs`: `unsupported`.
3. `r.attributes` (`a`) not an object, `a.name` without visible text, or `a.artistName` without visible text: `malformed`.
4. `songs`: `r.id` must be 1–15 ASCII digits, else `malformed`. `track`, with `available` true exactly when `a.playParams` is an object (Apple: "When present, this attribute indicates that the song is available to play").
5. `library-songs`: when `a.playParams.catalogId` is a string of 1–15 ASCII digits, `track` with that ID and `available: true`; otherwise `local`.

`title` is `a.name`, `artist` is `a.artistName`, `album` is `a.albumName`, `releaseDate` is `a.releaseDate`, and `isrc` comes from `a.isrc`.

## 4. Review

`reviewCandidates(candidates, deck)` returns one entry per candidate, in order: `{position, issues, ...}`. A candidate of kind other than `track` has exactly one issue, its kind. A `track` candidate has, in this order:

| Issue | When | Extra member |
| --- | --- | --- |
| `unavailable` | `available` is `false` | |
| `duplicate` | an earlier `track` candidate (lower index) has the same `provider` and `id` | `duplicateOf`: the first such candidate's `position` |
| `sameIsrc` | not `duplicate`, and an earlier `track` candidate has the same `isrc` | `sameIsrcAs`: the first such `position` |
| `inDeck` | a deck card has a link whose `linkTrack` ([game-rules.md](game-rules.md) section 8.1) has the candidate's `provider` and `id` | `cardId`: the first such card in deck order |
| `sameIsrcInDeck` | not `inDeck`, and a deck card's `isrc` equals the candidate's | `isrcCardId`: the first such card |
| `noYear` | there is no proposed year | |

Entries for other kinds have no other members. The **proposed year** of a `track` candidate (`proposedYear`, present when it exists) is the integer value of the first four digits of `releaseDate`, when it is from 1850 through 2100. It is a suggestion shown to the user, never a curated year: a release date often belongs to a reissue or compilation, and ISRC equality suggests the same recording but does not prove it.

A candidate with `inDeck` is already a card; re-importing a playlist therefore leaves existing cards, their IDs and every correction made to them untouched.

## 5. Promotion

`promoteCandidate(deck, candidate, decision)` returns the deck with one new card appended, or an error. `deck` is a deck of either version whose `cards` may be empty (a new deck built from a playlist). `decision` is `{gameYear, title?, artist?}`, where `gameYear` is a deck `gameYear` (`value`, `source`, optional `note`).

1. `candidate.kind` is not `track`: error `notTrack`.
2. The candidate is not one `normalizePlaylistPage` could produce: it fails [candidate-v1.schema.json](candidate-v1.schema.json), its `id` lacks its provider's shape (22 characters of `[0-9A-Za-z]` for Spotify, 1–15 ASCII digits for Apple Music), or its `url` is not the canonical URL for that ID (`https://open.spotify.com/track/<id>`, or `https://music.apple.com/<two lowercase ASCII letters>/song/<id>`): error `invalid`. Candidates may come back from storage, so the card's link is never taken on trust.
3. The candidate would have the `inDeck` issue: error `inDeck`.
4. The card ID is `sp-<id>` for Spotify and `am-<id>` for Apple Music; when a card already has that ID, the first of `<base>-2`, `<base>-3`, … that no card has.
5. The card is `{id, title, artist, gameYear, isrc?, links: [{provider, url, id, releaseDate?}]}`, with `title` and `artist` from the decision when given, else from the candidate, and `isrc` and `releaseDate` copied when the candidate has them. `album` is not copied: decks have no album member.
6. The resulting deck is validated by the deck rules for its own `schemaVersion`; a failure (for example a title over 500 code points, a year out of range, a source without visible text, or more than 2000 cards) is error `invalid`.

The provider release date is stored only as the link's raw `releaseDate`. Promotion never derives `gameYear` from it.
