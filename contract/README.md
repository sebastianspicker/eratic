# Deck interchange contract

[deck-v1.schema.json](deck-v1.schema.json) defines the portable file format for the SwiftUI Apple app and the standalone web companion. [deck-v2.schema.json](deck-v2.schema.json) adds optional clip, relation and difficulty members ([game-rules.md](game-rules.md) section 8.3); version 1 stays valid and unchanged. [session-v2.schema.json](session-v2.schema.json) is the structure of a recorded game session ([game-rules.md](game-rules.md) section 4); apps write version 2 and still read [session-v1.schema.json](session-v1.schema.json), which stays unchanged. Playlist review candidates are specified in [playlist-candidates.md](playlist-candidates.md) and [candidate-v1.schema.json](candidate-v1.schema.json). Files contain metadata and URLs, not audio. The example domain in `$id` is an identifier, not a deployed schema service.

The [demo deck](demo-deck.json) contains three fictional songs and example.com URLs. Both apps bundle it as their sample; it is not a playable music catalogue.

The [cases](cases) are the executable part of this contract. The Swift core tests and the web tests both run every case, so a rule is not part of the contract until it has a case here:

| File | What it pins |
| --- | --- |
| [deck-validation.json](cases/deck-validation.json) | Whole-deck accept/reject decisions. A case carries `deck` (a JSON value), `json` (exact file text, for syntax, number spelling and escapes) or `base64` (exact file bytes, for encodings). |
| [card-urls.json](cases/card-urls.json) | The URL rules below. Each URL is placed in a copy of the demo deck as a provider link or an official-card URL and must validate exactly when `valid` is true. |
| [qr-routes.json](cases/qr-routes.json) | Which exact payload a QR route produces for a card, or `null`. The `eraticCard` mode takes the Eratic card route ([game-rules.md](game-rules.md) section 8.2) from `eratic` `{host, deckId}`. |
| [game-primitives.json](cases/game-primitives.json) | Deterministic primitives, eras, scoring and imposter pairs: [game-rules.md](game-rules.md) sections 1–3, 6.8 and 8.3. |
| [game-replay.json](cases/game-replay.json) | Whole sessions replayed by the rules engine: the summary after the last action, or the index of the first rejected action ([game-rules.md](game-rules.md) sections 5–7). |
| [session-files.json](cases/session-files.json) | Session file text accepted or rejected by the strict session decoder ([game-rules.md](game-rules.md) section 4). |
| [provider-tracks.json](cases/provider-tracks.json) | The provider track identity parsed from a URL or link: [game-rules.md](game-rules.md) section 8.1. |
| [scan-resolution.json](cases/scan-resolution.json) | Which card, if any, a scanned payload selects in a deck: [game-rules.md](game-rules.md) section 8.2. |
| [playlist-candidates.json](cases/playlist-candidates.json) | Playlist review candidates: reference parsing, page decoding and normalization (a page is given decoded or as exact `json` text), review issues and promotion to a card ([playlist-candidates.md](playlist-candidates.md)). |

## Semantics

- `schemaVersion` is exactly `1` or `2` (version 2 only adds the optional members of [game-rules.md](game-rules.md) section 8.3; any of them in a version-1 file is rejected). Unknown versions and fields are rejected, rather than silently discarded on export.
- Deck and card IDs are stable, case-sensitive strings. Card IDs must be unique within a deck. Editing a year or replacing a playback URL must not change an ID.
- `gameYear.value` is a curated game answer from 1850 through 2100, inclusive. `source` records its evidence; `note` can explain the decision. These bounds are a version-one product choice, not a claim about the history of recorded music.
- Provider `releaseDate` is raw metadata. It must never overwrite the curated game year automatically. `recordingVersion` and optional ISRC help distinguish recordings; they do not prove provider equivalence.
- `links` can be empty. The user explicitly selects a provider link when previewing a provider QR. A URL is not a guarantee that audio exists or is available in a region.
- `officialCard` holds a user-supplied existing card URL and optional notes. Its presence means only that the URL passed input validation. It does not certify the song association, official-app playback, or arbitrary custom-song support.

## Additional validation

Implementations enforce these rules in addition to JSON Schema. They are written out explicitly rather than delegated to a platform URL parser, because WHATWG `URL` and Foundation `URLComponents` accept different inputs and Foundation's behaviour varies by OS version ([ADR 0008](../docs/adr/0008-explicit-text-and-url-rules.md)).

- A deck file is JSON text as defined by RFC 8259, encoded as UTF-8. A leading UTF-8 byte-order mark is ignored. Other encodings, invalid UTF-8, and non-standard syntax such as trailing commas or comments are rejected.
- An object never contains the same member name twice; names are compared after unescaping, so `"title"` and `"ti\u0074le"` are duplicates. JSON parsers disagree on which duplicate wins, so either app would otherwise read a different deck from the same file.
- Card IDs are unique within a deck (case-sensitive).
- Every string is well-formed Unicode: no unpaired UTF-16 surrogates.
- "Contains visible text" means what the schema's `"pattern": "\\S"` means in ECMAScript: at least one code point outside the ECMAScript whitespace set (U+0009–U+000D, U+0020, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF). This is the only "visible" check; other invisible characters in text fields are not rejected.
- A safe HTTPS URL has at most 2048 code points, starts with exactly `https://`, and contains no backslash and no code point of Unicode category Cc, Cf, Zs, Zl or Zp (as classified by the running platform; the cases pin the code points that matter). Its authority (the text before the first `/`, `?` or `#`) is a host, optionally followed by `:` and an empty port or a port whose numeric value is 443. The host is one or more characters, none of which is `[`, `]`, `<`, `>`, `^`, `|`, `%`, `"`, `` ` ``, `{`, `}`, `@` or `:`. So credentials, bracketed IP literals and percent-encoded hosts are rejected. Hosts are not otherwise checked: a numeric host such as `256.1.1.1` is accepted and simply fails to open. The path, query and fragment have no other restrictions.

Input URLs are preserved exactly, not canonicalized during export or QR generation.

Imported and exported deck files are limited to 8 MiB of UTF-8 data. Export uses readable formatting when it fits, otherwise compact JSON, so formatting alone cannot make an imported deck unsavable. Both boundaries check the byte count. String length limits use Unicode code points, not UTF-16 units or user-perceived grapheme clusters.

Official-card previews accept a conservative subset of known input families:

| Host | Path |
| --- | --- |
| `hitstergame.com`, `www.hitstergame.com` | `/<two letters>/<four letters and four digits>/<five digits>` or `/<two letters>/<five digits>` |
| `uqr.to` | `/<one to five alphanumeric characters>` |
| `app.hitsternordics.com` | `/resources/songs/<one to five digits>` |

Hosts compare case-insensitively and the original spelling is preserved. Official URLs must also be safe HTTPS URLs, and cannot have query strings, fragments, or any `:` in the authority. This policy is deliberately narrower than some recovered app matching expressions. It validates input locally and never queries or enumerates official identifiers. It can be revised when ordinary supported-input evidence establishes another format.

## Evolution

Keep schema, this document, Swift, TypeScript, and the cases aligned in one change; add a case for every rule you add or change. Breaking changes require a new schema version and explicit migration. Do not add manufactured official mappings to fixtures. Document sources and corrections when importing real user-owned deck metadata.
