# ADR 0004 Playlist imports produce review candidates

Date: 2026-10-11. Status: accepted; the candidate model is implemented in both cores ([contract](../../contract/playlist-candidates.md)), fetching and review screens are planned. The user requested Spotify and Apple Music playlist support.

## Context

The user added Digibitz's Spotify playlist-to-card flow as a reference and wants Apple Music support as well. Provider playlists can contain unavailable items, duplicates, alternate recordings, and dates that do not represent the intended game answer. A fetched record is not necessarily ready to print.

## Decision

Plan separate Spotify and Apple Music adapters yielding ordered review candidates with source identity, raw dates, recording information, availability, and per-item issues. Promote a candidate to a deck card only after its answer year and source are resolved. Preserve corrections and stable IDs on re-import. Keep playlist import independent of playback and QR route selection.

Implement the candidate model and local fixtures first. Add live provider access after determining authorization, applicable product-use constraints, and the standalone web token strategy. No playlist-fetching code or connected state is claimed in this scaffold.

## Consequences

The review stage can handle missing metadata without invented years. Both providers feed one curation flow, while retaining market/storefront distinctions. A web token service, if needed, must remain optional for local deck editing and must not expose signing keys. Provider setup does not block file interchange.

## Alternatives and revisit condition

Directly converting an API response to printable cards would hide metadata ambiguity. Scraping public page layouts would introduce a fragile import dependency. Revisit adapter details against the current documented provider APIs when implementation begins; retain the review boundary unless the user explicitly changes the data-quality requirement.

References: [playlist plan and primary documentation](../playlist-import.md), [Digibitz](https://www.digibitz.nl/hitster-kaarten/), [TrackMatch inspiration](https://github.com/jlnbxn/TrackMatch).

