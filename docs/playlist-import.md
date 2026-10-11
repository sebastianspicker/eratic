# Spotify and Apple Music playlist import

The intended flow is **playlist URL → import candidates → review recordings and years → curated deck → QR route selection → printable cards**. Both Spotify and Apple Music are first-class input sources. The candidate model is implemented in both cores and specified in [`contract/playlist-candidates.md`](../contract/playlist-candidates.md): playlist reference parsing, normalization of provider response pages into candidates, review issues and promotion to a card. Provider fetching and the review screens are not built yet.

## Reference and extension

[Digibitz](https://www.digibitz.nl/hitster-kaarten/) already accepts a Spotify playlist URL, generates downloadable cards, and describes printing front and back pages with an initial alignment test. It explicitly states that its cards require its own QR scanner and cannot be scanned with the Hitster app. These observations describe its public interface, not its internal implementation.

We adopt the short playlist-to-print flow and add Apple Music input, an explicit metadata review step, source-backed game years, recording-version awareness, resumable imports, and a clear choice of playback route. The UI should show which entries need attention instead of treating a completed fetch as a print-ready deck.

## Proposed adapter contract

Each provider adapter accepts a parsed playlist reference, the relevant market/storefront, and its own authorization context. It yields ordered pages of `ImportCandidate` records plus progress and per-item issues. A candidate should contain:

- Provider, playlist ID, position, fetch time, and optional snapshot/version marker.
- Original provider track ID and URL, title, artists, raw release date and its precision, optional ISRC, and recording/version information.
- Availability, missing or unsupported item type, and any suggested cross-provider match with evidence and confidence.
- A separate proposed game year with provenance, followed by a deliberate user decision before promotion to a card.

Candidates are a separate draft format, not version-one deck cards. The current deck requires a curated game year and source. Do not insert a default year to make an incomplete import validate. Preserve playlist order, report duplicates, and offer explicit deduplication rather than silently dropping entries. Re-import should reconcile provider identity to existing stable card IDs and preserve corrections.

## Provider-specific work

| Source | Planned integration | Important distinction |
| --- | --- | --- |
| Spotify | Documented playlist-items API (`GET /v1/playlists/{id}/items`), scoped user authorization, pagination and rate-limit handling | The older `/tracks` endpoint is deprecated, and so is each entry's `track` member in favour of `item`; normalization reads `item` and falls back to `track`. The reference page (checked 2026-10-11) states the endpoint returns 403 unless the current user owns or collaborates on the playlist, so importing someone else's public playlist may not be possible through this API. Verify with a live account before designing the import screen around arbitrary playlist links. |
| Apple Music | MusicKit on Apple platforms or the Apple Music API as appropriate; explicit storefront and catalog versus personal-library handling | A catalog playlist and an authorized personal-library playlist are different sources. IDs and availability need storefront context: a catalog song without `playParams` is not playable in that storefront, and a library song is a track only when it has a catalogue ID. |

Primary references: [current Spotify playlist items](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items), [Spotify PKCE](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [Apple catalog playlist](https://developer.apple.com/documentation/applemusicapi/get-a-catalog-playlist), and [Apple developer tokens](https://developer.apple.com/documentation/applemusicapi/generating-developer-tokens).

The static web editor must continue to work without a service. A future Apple Music web integration may need a narrowly scoped token service; signing keys must not be shipped in browser assets. Provider authorization and credential storage need an implementation decision before live integration. JSON interchange remains the local path between platforms.

Spotify's developer policy currently prohibits games, including trivia quizzes, so technical API access alone does not settle whether the proposed product can use that integration. Resolve the intended use with the provider before making it a production dependency. This is separate from storing user-supplied links. [Spotify Developer Policy](https://developer.spotify.com/policy)

## Acceptance checks for a future implementation

1. Import both a Spotify and an Apple Music playlist through supported authorized interfaces; preserve ordering across multiple pages.
2. Surface missing, local, duplicate, unavailable, and unsupported items without losing successfully imported entries.
3. Keep provider release metadata separate from the curated answer year; allow source and rationale corrections.
4. Review alternate recordings and cross-provider suggestions before accepting them. ISRC helps identify a recording but is not a complete guarantee.
5. Save the reviewed deck and reopen it on Apple and web without losing IDs, links, or year provenance.
6. Require a QR route explicitly. Importing a playlist must never manufacture official Hitster catalogue mappings.
7. Generate a print alignment sheet before the full deck, then validate QR readability and front/back ordering.

