# Project status

Updated 2026-10-11. Eratic is a native Mac/iPad/iPhone app and an independent static web companion. This file tracks current capabilities, verification, next steps and open decisions. Historical ledgers and research are archived locally; the [contract](../contract/README.md), [architecture](../ARCHITECTURE.md), [design](../DESIGN.md) and [ADRs](adr/README.md) remain authoritative.

## Implemented

Public positioning focuses on user-curated decks and their linked QR codes. Original HITSTER-card support and official-app compatibility are not advertised features or public roadmap commitments. Existing supplied-URL fields remain technical capabilities, with no automatic catalogue lookup. See [ADR 0013](adr/0013-public-card-support-positioning.md).

- **Decks:** strict import/export of deck versions 1 and 2, stable card IDs, source-backed year curation, optional clip starts, difficulty and related recordings. Both cores run the same contract cases.
- **QR routes:** explicit direct-provider links or supplied official mappings labelled unverified. A provider-independent Eratic route is implemented but unavailable until a card domain is configured. No official-app arbitrary-song compatibility has been demonstrated.
- **Games:** all [nine modes](game-modes.md), with their supported Name It, Stakes, Kids and Sudden Death modifiers. Session action logs and deck snapshots support saved games and replay; scores come from the cores.
- **Scanning:** AVFoundation/Vision on Apple; BarcodeDetector or jsQR on the web. Scanning selects cards in the loaded deck and does not open arbitrary URLs.
- **Playback adapters:** Spotify, Apple Music and manual playback. Provider playback needs credentials and live-account verification. Exact clips use audible-start timing with an in-app calibration.
- **Storage:** web decks and games persist locally with unreadable-value quarantine; native games persist in Application Support and deck edits require export. No backend or cross-device synchronization.
- **Presentation:** nine era styles, sourced from `design/eras.json`, with scoring boundaries in `contract/eras.json`. QR codes remain black on white.
- **Playlist candidates:** both cores parse playlist references, normalize provider pages, report review issues and promote candidates only with a curated year and source. Shared fixtures cover these rules. No live retrieval or review screens yet.

## Verification

Local verification on 2026-10-11 with macOS 27, Node 26.10 and Xcode Swift 6.4:

| Check | Result |
| --- | --- |
| `make web-check` | Exit 0: 1712 tests in 26 files, TypeScript and production build |
| `make core-test` | Exit 0: actual SwiftPM, 94 tests, no failures; includes playlist candidates |
| `make apple-build` | Exit 0: unsigned macOS and generic iOS Simulator builds |
| Production CSP | Browser startup passes; standalone schema validators require no runtime code evaluation |
| Native Mac smoke check | Deck and Bullseye setup, draw, locked guesses, reveal and results inspected; Start keeps Play selected |
| Browser smoke checks | Chrome at 1440×1000 and 390×844: Bullseye (including reload/resume), Timeline, Era Sort, Higher or Lower, Relay, Lineup by name and five-round Daily Eratic through results |
| Browser accessibility/layout sample | Timeline arrow/Enter selection, era-grid arrow selection, Lineup reorder controls, reveal-heading focus, Reduce Motion, no console errors, error overlay or horizontal overflow in the tested flows |

These are focused checks, not exhaustive acceptance. Still unverified:

- Live Spotify/Apple Music playback, regional availability, provider CSP hosts, preview-tier behavior and the 150 ms clip-timing target.
- Rendered gameplay for Snippet Ladder and Original or Imposter; wider modifier/keyboard coverage, VoiceOver, Dynamic Type and mobile Safari.
- Native iPhone/iPad rendering: builds pass; simulator UI checks were explicitly skipped in the latest acceptance pass.
- Physical cameras/printed cards, physical devices, signing and release packaging.
- Coverage beyond the current [GitHub CI checks](https://github.com/sebastianspicker/eratic/actions/workflows/check.yml); the current workflow status is available there.

## Next work

1. Build playlist review screens in both apps, initially using local fixture pages. Show review issues and proposed years; require a curated year and source before promotion. Re-import must preserve existing cards and IDs.
2. Decide whether candidate lists are transient or persisted. Persistence requires a storage key/quarantine and a strict Swift candidate decoder; synthesized `Candidate` decoding currently does not enforce every schema constraint.
3. Validate live provider access, authorization and intended-use terms before implementing fetchers. The Spotify playlist-items documentation currently restricts access to owned/collaborated playlists; confirm account behavior before promising arbitrary public-playlist import. See [playlist design](playlist-import.md).
4. Add a print-layout model with duplex ordering, margins, trim marks, an alignment sheet and an answer key, then native PDF and browser print output.

## Open decisions

| Decision | Current state |
| --- | --- |
| Eratic card domain | Route implemented; no domain configured. The Pages demo URL is not an official-card mapping or a card resolver. |
| Multi-device play | Out of scope; one host device per game |
| Provider registration and suitability | Adapters implemented; live accounts, credentials and production-use suitability remain unverified |
| Web Apple Music authorization | Optional build-time developer token, minted offline; no signing key in browser assets. A future token service is undecided. |
| Native deck autosave | Explicit export today; document-based autosave is undecided |
| Accessibility variant | The original Snippet Ladder proposal included an untimed variant. Its intended behavior and acceptance still need definition; it is not claimed as a separate implemented mode. |
| Print defaults | Card/page sizes, duplex convention and calibration need an implemented test sheet |
| Licence and release identity | No distribution licence selected. Trademark, production bundle IDs, signing and native distribution remain unresolved. |

## Public demo

[Source repository](https://github.com/sebastianspicker/eratic) and [GitHub Pages demo](https://sebastianspicker.github.io/eratic/) are public. The Pages workflow deployed successfully, and the live site passed the same twelve desktop/phone smoke scenarios for Timeline, Era Sort, Higher or Lower, Relay, Lineup by name and Daily Eratic. The first hosted Apple CI run exposed a compiler-sensitive array concatenation; explicit appends preserve the standings order and pass all 94 local Swift tests. See [Checks](https://github.com/sebastianspicker/eratic/actions/workflows/check.yml) for hosted verification. The demo uses fictional sample data and has no provider credentials. Account-free editing and manual game hosting remain usable. Do not upload local research, private decks, exports or credentials; publication boundaries are recorded in [ADR 0012](adr/0012-public-repository-and-private-archive.md).
