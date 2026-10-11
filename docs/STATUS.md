# Project status

Updated 2026-10-11. Eratic is a native Mac/iPad/iPhone app and an independent static web companion. This file tracks current capabilities, verification, next steps and open decisions. Historical ledgers and research are archived locally; the [contract](../contract/README.md), [architecture](../ARCHITECTURE.md), [design](../DESIGN.md) and [ADRs](adr/README.md) remain authoritative.

## Implemented

Public positioning focuses on user-curated decks and their linked QR codes. Original HITSTER-card support and official-app compatibility are not advertised features or public roadmap commitments. Existing supplied-URL fields remain technical capabilities, with no automatic catalogue lookup. See [ADR 0013](adr/0013-public-card-support-positioning.md).

- **Decks:** strict import/export of deck versions 1 and 2, stable card IDs, source-backed year curation, optional clip starts, difficulty and related recordings. Both cores run the same contract cases.
- **QR routes:** explicit direct-provider links or supplied official mappings labelled unverified. A provider-independent Eratic route is implemented but unavailable until a card domain is configured. No official-app arbitrary-song compatibility has been demonstrated.
- **Games:** all [nine modes](game-modes.md), with their supported Name It, Stakes, Kids and Sudden Death modifiers. Session action logs and deck snapshots support saved games and replay; scores come from the cores.
- **Scanning:** AVFoundation/Vision on Apple; BarcodeDetector or jsQR on the web. Scanning selects cards in the loaded deck and does not open arbitrary URLs.
- **Playback adapters:** Spotify, Apple Music and manual playback are selectable without credentials or developer configuration. Native links prefer installed music apps; ordinary provider selection reuses existing Eratic authorization or falls back to QR/song links. Native MusicKit uses the device's subscription after system permission. Interactive authorization for timed playback is optional and requires developer setup for Spotify/web MusicKit. Unknown accounts are not labelled Spotify Free. Without exact clips, Lineup uses titles, Snippet Ladder uses timed preview snippets when available, and Original or Imposter is played by hand from the song backup. Single-card stages also offer on-demand Spotify and Apple Music previews without app credentials. Both have hidden playback with host transport controls; Apple uses the public preview file and offers a revealed embed if that fails or is unavailable. Failed attempts stop and retain retry/fallback controls; late callbacks cannot restart them. Native Apple startup and buffering have bounded waits. QR/app links remain available. Previews do not qualify as exact clips. Live subscription/device behavior remains unverified. See [ADR 0014](adr/0014-app-first-playback.md).
- **Song backup:** every mode shows each card's QR and hidden preview (Spotify/Apple Music) whatever the provider or tier, collapsed behind a disclosure when clips are exact. All nine modes start without exact clips: Snippet Ladder plays each step as a self-stopping snippet of the hidden preview (by hand only when no preview exists), and Original or Imposter is played by hand. A game started without *Use playback* runs as Play it yourself. A silent Spotify autoplay is retried once, then falls back to *Play*. Snippet startup blocks repeated presses; hosts can stop a snippet, and opening the answer stops playback before scoring. Preview failures retain a specific explanation alongside manual fallback.
- **Sessions:** new games are written as session version 2, whose Snippet Ladder steps are at most 30 s (default 1·5·10·20·30 s); version 1 games and files stay readable under their old rules ([ADR 0016](adr/0016-session-v2-ladder-step-cap.md)).
- **Storage:** web decks and games persist locally with unreadable-value quarantine; native games persist in Application Support and deck edits require export. No backend or cross-device synchronization.
- **Presentation:** nine era styles, sourced from `design/eras.json`, with scoring boundaries in `contract/eras.json`. QR codes remain black on white.
- **Playlist candidates:** both cores parse playlist references, normalize provider pages, report review issues and promote candidates only with a curated year and source. Shared fixtures cover these rules. No live retrieval or review screens yet.

## Verification

Local verification on 2026-10-11 with macOS 27, Node 26.10 and Xcode Swift 6.4:

| Check | Result |
| --- | --- |
| `make web-check` | Exit 0: 1813 tests in 30 files, TypeScript and production build |
| `make core-test` | Exit 0: actual SwiftPM, 96 tests, no failures; includes playlist candidates and session-v2 changes |
| `make apple-build` | Exit 0 after the song-backup, session-v2 and snippet-control changes: full unsigned macOS and generic iOS Simulator builds |
| `make apple-preview-test` | Exit 0: 13 native Apple preview scenarios (recovery and snippets) against the actual player source and AVFoundation with controlled inputs; lookup/start/stall expiry, pause/restart/seek races, stale callbacks, retry, disposal and deinit. Apple CI now runs this harness. Five web-suite tests execute the actual native Spotify bridge script. These checks do not verify audible playback. |
| Production CSP | Browser startup passes; standalone schema validators require no runtime code evaluation |
| Native Mac smoke check | Deck and Bullseye setup, draw, locked guesses, reveal and results inspected; Start keeps Play selected |
| Browser smoke checks | Chrome at 1440×1000 and 390×844: Bullseye (including reload/resume), Timeline, Era Sort, Higher or Lower, Relay, Lineup by name and five-round Daily Eratic through results |
| Manual-play QR | Chrome at 1440×1000 and 390×844: Play it yourself → Bullseye → draw shows a QR; its rendered SVG rasterized at 180 px decodes to the current song link. Reload/resume and final results pass; scan-caption contrast corrected. Apple QR implementation compiles for macOS and iOS; native QR scanning/rendering not checked. |
| Provider selection without credentials | Chrome at 1440×1000 and 390×844: Spotify, Apple Music and manual each reach Bullseye results, including reload/resume, with no provider network requests. Each QR decodes to the selected provider's supplied URL. Unit tests cover authorization reuse, explicit sign-in, Free fallback and stale-tier clearing after connect failure. Updated macOS/iOS app builds pass; installed-app routing and live subscriptions still need device checks. |
| Embedded previews | Chrome production build at 1440×1000 and 390×1000: signed-out Spotify (manual and selected-provider routes) and Apple Music play real audio, stop/replay, hide metadata and remove frames on reveal. Six scenarios pass with no console/page errors or horizontal overflow. Loading starts only on request. A blocked-load test retains the QR, recovers via Retry and unloads audio before external app-link playback. A native macOS WebKit probe using the app's Spotify HTML reports ready → starting → playing → disposal; both native targets build. Full native UI, native Apple audio and iOS audio remain unverified. Hidden transport (2026-10-11, one *Play preview*, then Play/Pause, Back 10 s, Restart and a position slider; Apple via the iTunes Lookup preview file) passes in Chrome against the production build at 1440×1000 and 390×1000 for signed-out Spotify and Apple Music: real audio advances, Pause holds, seeking to 0:20 resumes there, Back 10 s and Restart move the position, no song text appears on the host screen, reveal removes the preview, no console errors or overflow. Native playback of the new controls is unverified. |
| Snippet Ladder preview controls | Chrome production build at 1440×1000 and 390×1000, signed-out Spotify and Apple Music: Play 1 s → self-stop → replay → More time → Stop snippet → lock → Show answer → Score card passes. Media advances and pauses; opening the answer removes the Spotify frame / pauses Apple audio. Song metadata stays hidden before the answer; no app errors, overlays or page overflow. Spotify emits its provider iframe allow/allowfullscreen warning. First-step stopped media positions were about 1.005–1.007 s (Spotify) and 0.950–0.951 s (Apple); these samples do not measure audible timing accuracy. |
| Browser accessibility/layout sample | Timeline arrow/Enter selection, era-grid arrow selection, Lineup reorder controls, reveal-heading focus, Reduce Motion, no console errors, error overlay or horizontal overflow in the tested flows |

These are focused checks, not exhaustive acceptance. Still unverified:

- Authorized Spotify/Apple Music playback, regional/catalogue availability, native end-to-end embed audio and the 150 ms clip-timing target. Browser embed playback has separate focused evidence below; it does not validate timed adapters or device subscriptions.
- Rendered exact/manual-fallback Snippet Ladder and Original or Imposter, song backups outside the tested browser flows, whether the Spotify autoplay retry fixes the silent first start in Safari and WebKit, and accurate audible timing of Ladder preview snippets across songs/devices (Spotify position reports are coarse); wider modifier/keyboard coverage, VoiceOver, Dynamic Type and mobile Safari.
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
| Licence and release identity | Own code under the MIT License ([ADR 0015](adr/0015-mit-licence.md)). Trademark, production bundle IDs, signing and native distribution remain unresolved. |

## Public demo

[Source repository](https://github.com/sebastianspicker/eratic) and [GitHub Pages demo](https://sebastianspicker.github.io/eratic/) are public. The Pages workflow deployed successfully, and the live site passed the same twelve desktop/phone smoke scenarios for Timeline, Era Sort, Higher or Lower, Relay, Lineup by name and Daily Eratic. The first hosted Apple CI run exposed a compiler-sensitive array concatenation; explicit appends preserve the standings order and pass all 94 local Swift tests. See [Checks](https://github.com/sebastianspicker/eratic/actions/workflows/check.yml) for hosted verification. The demo uses fictional sample data and has no provider credentials. Account-free editing and manual game hosting remain usable. Do not upload local research, private decks, exports or credentials; publication boundaries are recorded in [ADR 0012](adr/0012-public-repository-and-private-archive.md).
