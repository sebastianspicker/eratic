# Architecture

Two independent applications share file formats and rules, not code. A native SwiftUI app serves Mac, iPad, and iPhone. A static React/TypeScript app serves browsers without the Apple app or a backend. Both read and write the versioned deck JSON and the game session files defined in [`contract/`](contract/README.md), both implement the game rules of [`contract/game-rules.md`](contract/game-rules.md), and both prove it by running the same contract cases.

What the repository is made of, and which way the parts depend on each other:

```mermaid
flowchart LR
  subgraph contract["contract/ (canonical)"]
    schemas["deck, session and<br/>candidate schemas"]
    rules["game-rules.md"]
    cases["cases/*.json"]
  end
  design["design/eras.json"]
  subgraph apple["apps/apple"]
    aui["SwiftUI Sources"] --> acore["EraticCore"]
  end
  subgraph web["apps/web/src"]
    wui["ui/"] --> wcore["core/"]
    wui --> wio["playback, scanner,<br/>storage, sessions"]
  end
  acore -.->|"swift test runs"| cases
  wcore -.->|"vitest runs"| cases
  wcore -->|"AJV validators from"| schemas
  acore -->|implements| rules
  wcore -->|implements| rules
  aui -->|bundles| design
  wui -->|imports| design
  aui <-->|"deck JSON files"| wui
```

The two `core` boxes are the heart of the system: each implements the deck format and the rules engine once, and each proves it by running the same `contract/cases/`. The UI layers on top only build actions, render state and talk to the outside world (files, browser storage, music providers, the camera). The only thing the two apps exchange at runtime is a deck file the user moves between them.

Where in the code: [contract/README.md](contract/README.md), [contract/game-rules.md](contract/game-rules.md), [apps/apple/EraticCore/Sources/EraticCore/](apps/apple/EraticCore/Sources/EraticCore/), [apps/web/src/core/](apps/web/src/core/), [design/eras.json](design/eras.json).

## Components

| Component | Owns | Must not |
| --- | --- | --- |
| `contract/` | The deck-v1, deck-v2, session-v1 and session-v2 JSON Schemas, the semantic rules the schemas cannot express, the game rules (`game-rules.md`), era boundaries (`eras.json`), the fictional sample deck, and every case both cores run | Depend on either app |
| `apps/apple/EraticCore` | Swift models, strict JSON-text checks (`StrictJSON`), decoding and encoding, validation, the card URL policy, QR route selection, curation, the game primitives and rules engine (`Random`, `Scoring`, `GameEngine`, `GameModes`, `GameQueries`), session files (`Session`, `SessionCodec`) and scan resolution (`Scan`) | Import SwiftUI or hold UI strings; it is Foundation-only so its tests need no simulator |
| `apps/apple/Sources` | SwiftUI workspace, file import and export dialogs, editing sheets, Core Image QR rendering, display labels, era styling; `Game/` (Play home, setup, host screen, mode inputs, `GameController`, `SessionStore`), `Playback/` (provider adapters, clip timing, calibration) and `Scanner/` (AVFoundation + Vision) | Re-implement deck or game rules; call the core instead |
| `apps/web/src/core` | TypeScript mirror of EraticCore: `deck.ts` (types, byte and text decoding, duplicate-name check, AJV schema check, semantic validation, codec, sample, curation, v2 migration), `cardUrls.ts` (URL policy, QR route), `random.ts`, `eras.ts`, `scoring.ts`, `scan.ts`, `session.ts` and `game/` (rules engine per mode) | Import React or touch the DOM or browser storage; an architecture test enforces this |
| `apps/web/src/storage.ts` | The browser's saved deck in `localStorage` (`qr-song-quiz.deck.v1`), including quarantine of an unreadable saved value | Overwrite saved data it cannot read before a copy is kept under the quarantine key |
| `apps/web/src/qrSvg.ts` | SVG QR rendering with the `qrcode` dependency | Choose or alter payloads |
| `apps/web/src/sessions.ts` | The current game session (`eratic.session.v1`), its deck snapshot and the Daily record (`eratic.daily.v1`) in `localStorage`, with the same quarantine as decks | Overwrite an unreadable saved session |
| `apps/web/src/playback`, `apps/web/src/scanner` | Provider adapters (Spotify Web Playback SDK and Web API, MusicKit JS, manual), clip timing, calibration; camera QR decoding (`BarcodeDetector`, else jsQR) | Hold game rules, or load provider scripts before a connection, explicit preview request or a Snippet Ladder draw |
| `apps/web/src/ui` | React screens, notices, file download and upload, era styling (`eras.ts`, `Wordmark.tsx`); `game/` (Play home, setup, host screen, mode inputs through a registry, the game controller) | Re-implement deck or game rules |
| `design/eras.json` | Presentation tokens for the nine eras (same IDs and order as `contract/eras.json`); read by the web UI, and bundled into the Apple app, where `EraticCore` joins them with the contract's boundaries (`EraTokens.swift`) | Hold deck data, rules or era boundaries |

Dependencies point one way: UI → core → contract. The two cores hold the same concepts in matching places, so a rule change is easy to find in both:

| Concept | Swift (`EraticCore`) | TypeScript (`src/core`) |
| --- | --- | --- |
| Models | `Deck.swift` | `deck.ts` types |
| File bytes and JSON text | `StrictJSON.validate`, `DeckCodec.decode(Data)` | `decodeDeckBytes`, `parseDeck` |
| Validation and export | `DeckCodec.validate`, `DeckCodec.encode` | `validateDeck`, `exportDeck` |
| URL policy | `CardURLPolicy.isSafeHTTPS`, `.isOfficialCardURL` | `isSafeHTTPS`, `isOfficialCardURL` |
| QR route | `QRMode`, `QRRoute.payload` | `QRMode`, `qrPayload` |
| Curation | `Deck.updatingGameYear` | `updateGameYear` |
| Sample deck | bundled resource, loaded by the app | `demoDeck()` |
| Determinism | `Random.swift` (`fnv1a32`, `Mulberry32`, `drawOrder`, `pickAnchors`, `dailySelection`) | `random.ts` |
| Eras | `EraBoundaries.swift` | `eras.ts` |
| Scoring primitives | `Scoring.swift` | `scoring.ts` |
| Rules engine | `GameEngine.swift`, `GameModes.swift`, `GameQueries.swift` | `game/engine.ts`, `game/<mode>.ts` |
| Session files | `Session.swift`, `SessionCodec.swift` | `session.ts` |
| Scan and provider tracks | `Scan.swift` (`ScanRules`) | `scan.ts` |
| Playlist candidates | `Playlist.swift` (`PlaylistRules`) | `playlist.ts` |

## How it runs

There is no server of our own. The web app is a static bundle; everything runs in one browser tab and talks only to the music providers. This is the web runtime when a host plays a game:

```mermaid
flowchart LR
  host((Host))
  pages["Static host<br/>(GitHub Pages demo)"]
  subgraph tab["Browser tab"]
    ui["React ui/"]
    ctrl["GameController"]
    core["core/ engine"]
    hub["PlaybackHub"]
    scanner["qrScanner"]
    ls[("localStorage")]
  end
  providers["Spotify / Apple Music"]
  pages -->|"HTML + JS bundle"| ui
  host -->|"clicks, camera"| ui
  ui -->|"draw, scan, dispatch"| ctrl
  ctrl -->|"applyAction, replay"| core
  ctrl -->|"persistSession"| ls
  ui -->|"persistDeck"| ls
  ui -->|"play clip"| hub
  hub -->|"Web Playback SDK,<br/>MusicKit JS"| providers
  ui -->|"start camera"| scanner
  classDef focus fill:#fde68a,stroke:#b45309,color:#1f2937
  class ctrl focus
```

`GameController` is the only stateful game piece in the UI: it turns a host's input into an action, asks the core to apply it, and saves the whole session after every action. `PlaybackHub` creates a provider adapter only when the host picks one (Play it yourself needs no network at all). Provider scripts load from the provider's CDN on demand, and the scanner decodes frames locally with `BarcodeDetector` or jsQR. The public demo is built without provider credentials, so it only offers previews, links and Play it yourself.

The Apple app is one SwiftUI process with the same pieces under different names. It stores the deck only through files the user exports, and the running game under Application Support:

| Piece | Web (`apps/web/src`) | Apple (`apps/apple/Sources`) |
| --- | --- | --- |
| Game controller | [ui/game/useGame.ts](apps/web/src/ui/game/useGame.ts) `GameController` | [Game/GameController.swift](apps/apple/Sources/Game/GameController.swift) |
| Session storage | [sessions.ts](apps/web/src/sessions.ts) → `localStorage` `eratic.session.v1` | [Game/SessionStore.swift](apps/apple/Sources/Game/SessionStore.swift) → `Eratic/Sessions/current.json` + `current-deck.json` |
| Deck storage | [storage.ts](apps/web/src/storage.ts) → `localStorage` `qr-song-quiz.deck.v1` | import/export dialogs in [DeckWorkspace.swift](apps/apple/Sources/DeckWorkspace.swift) |
| Playback | [playback/hub.ts](apps/web/src/playback/hub.ts): Web Playback SDK + Web API, MusicKit JS, manual | [Playback/PlaybackHub.swift](apps/apple/Sources/Playback/PlaybackHub.swift): Spotify Connect via Web API, MusicKit `ApplicationMusicPlayer`, manual |
| Clip timing | [playback/clip.ts](apps/web/src/playback/clip.ts) | [Playback/ClipController.swift](apps/apple/Sources/Playback/ClipController.swift) |
| QR scanner | [scanner/qrScanner.ts](apps/web/src/scanner/qrScanner.ts) (`getUserMedia`) | [Scanner/QRScanner.swift](apps/apple/Sources/Scanner/QRScanner.swift) (AVFoundation + Vision) |

## User journeys

### Importing a deck (web)

What happens between choosing a file and seeing its cards:

```mermaid
sequenceDiagram
  autonumber
  actor H as Host
  participant app as App.tsx
  participant deck as core/deck.ts
  participant store as storage.ts
  participant ls as localStorage
  H->>app: Choose a .json file
  app->>app: Reject files over 8 MiB
  app->>deck: decodeDeckBytes(bytes)
  deck->>deck: UTF-8, duplicate names, schema, semantic rules
  alt invalid
    deck-->>app: throws with the reason
    app-->>H: Notice with the reason
  else valid
    deck-->>app: Deck
    app-->>H: Confirm replacing the current deck
    app->>store: persistDeck(deck)
    store->>ls: setItem(qr-song-quiz.deck.v1)
    app-->>H: Card list shows the new deck
  end
```

Validation (step 4) is the same strict pipeline the contract cases test, so a file either opens identically in both apps or is refused in both. Saving (steps 9–10) never overwrites a stored value it cannot read: `storage.ts` first copies it to the `.unreadable` key. On Apple the file arrives through the system import dialog and goes through `DeckCodec.decode`; nothing is stored until the user exports.

Where in the code: [apps/web/src/ui/App.tsx](apps/web/src/ui/App.tsx) (`importFile`, `installDeck`), [apps/web/src/core/deck.ts](apps/web/src/core/deck.ts) (`decodeDeckBytes`), [apps/web/src/storage.ts](apps/web/src/storage.ts) (`persistDeck`), [apps/apple/EraticCore/Sources/EraticCore/DeckCodec.swift](apps/apple/EraticCore/Sources/EraticCore/DeckCodec.swift).

### Playing one card (web)

What happens in a round from drawing a card to the reveal:

```mermaid
sequenceDiagram
  autonumber
  actor H as Host
  participant ui as Host / Stage
  participant ctrl as GameController
  participant core as core/game/engine
  participant hub as PlaybackHub + ClipController
  participant ls as localStorage
  H->>ui: Draw (or scan a QR code)
  ui->>ctrl: draw(deck) / scan(payload, deck)
  ctrl->>core: applyAction(draw)
  core-->>ctrl: state, phase open
  ctrl->>ls: persistSession
  H->>ui: Play
  ui->>hub: prepare + clip.start(from, length)
  hub--)ui: audible
  ui->>ctrl: dispatch(clip)
  H->>ui: Enter each player's answer
  ui->>ctrl: dispatch(guess / place / pickEra …)
  H->>ui: Reveal
  ui->>ctrl: dispatch(reveal)
  ctrl->>core: applyAction(reveal)
  core-->>ctrl: scores, phase awaitingDraw or finished
  ctrl->>ls: persistSession
  ctrl-->>ui: new summary
```

Every arrow into `GameController` ends the same way: the core applies one action to the state, the action is appended to the session log, and the log is saved (drawn out for the draw and the reveal, and the same after steps 9 and 11). A rejected action throws a `GameError`, so the state and the log stay unchanged and the host sees the reason. The `clip` action (step 9) is recorded only once audio is actually audible, so the log says what players heard; it does not change scores. A scan (step 2) only selects a card through `resolveScan`; it never starts playback.

Where in the code: [apps/web/src/ui/game/Host.tsx](apps/web/src/ui/game/Host.tsx), [apps/web/src/ui/game/Stage.tsx](apps/web/src/ui/game/Stage.tsx), [apps/web/src/ui/game/useGame.ts](apps/web/src/ui/game/useGame.ts) (`draw`, `scan`, `dispatch`), [apps/web/src/ui/game/playback.ts](apps/web/src/ui/game/playback.ts) (`useCardPlayer`), [apps/web/src/core/game/engine.ts](apps/web/src/core/game/engine.ts) (`applyAction`, `replay`), [apps/web/src/core/scan.ts](apps/web/src/core/scan.ts).

### Game phases

The states a game goes through in the engine (`Phase` in both cores):

```mermaid
stateDiagram-v2
  [*] --> setup: Timeline, Relay, Higher or Lower
  [*] --> awaitingDraw: other modes
  setup --> awaitingDraw: anchor / reference
  awaitingDraw --> open: draw
  open --> awaitingDraw: reveal, skip
  open --> finished: reveal, end (no tie)
  awaitingDraw --> finished: end (no tie)
  open --> suddenDeath: reveal, end (tie)
  awaitingDraw --> suddenDeath: end (tie)
  suddenDeath --> suddenDeathOpen: sdDraw
  suddenDeathOpen --> suddenDeath: reveal (still tied), skip
  suddenDeathOpen --> finished: reveal (winner), end
  suddenDeath --> finished: end
  finished --> [*]
```

A reveal ends the game when the mode's own end condition is met (target score, rounds, lives); a tie for first place then enters sudden death if the mode defines one. Answers and wagers are only accepted in `open` and `suddenDeathOpen`, which is also the only time Undo can take an entry back.

Where in the code: [apps/web/src/core/game/common.ts](apps/web/src/core/game/common.ts) (`Phase`), [apps/web/src/core/game/engine.ts](apps/web/src/core/game/engine.ts) (`step`, `reveal`, `end`, `evaluateEnd`), [apps/apple/EraticCore/Sources/EraticCore/GameEngine.swift](apps/apple/EraticCore/Sources/EraticCore/GameEngine.swift).

## Contract and parity

The JSON Schema is canonical, and `contract/README.md` adds the rules a schema cannot express: duplicate IDs, well-formed strings, and the URL grammar. The rules are written out explicitly rather than delegated to a platform URL parser, because WHATWG `URL` and Foundation `URLComponents` disagree ([ADR 0008](docs/adr/0008-explicit-text-and-url-rules.md)). Both test suites run every file in `contract/cases/`. A rule exists in the contract once it has a case there, and a change lands in the schema, the README, the cases, Swift, and TypeScript together.

Validation is strict. Files must be RFC 8259 JSON in UTF-8 without duplicate member names; unknown fields, unknown versions, and nulls are rejected, so an older application cannot silently drop newer data on export. Stable card IDs belong to the deck. Provider IDs, URLs, and release dates belong to optional links. Editing an answer year or replacing a link never recreates a card. Files are limited to 8 MiB of UTF-8, and export falls back to compact JSON when indentation alone would exceed the limit.

## QR routes

Official mode is the default. It encodes only a supplied official-card URL of a recognized shape, labelled unverified. Without a mapping there is no payload. Direct-link mode must be chosen explicitly and encodes the selected provider URL exactly as supplied. Neither mode fabricates identifiers, substitutes one route for the other, or infers playback compatibility from URL syntax ([ADR 0003](docs/adr/0003-explicit-qr-routes.md)). The route decision lives in the core. Rendering lives in the UI layer: Core Image on Apple, `qrcode` SVG on the web.

## State and side effects

- **Apple:** the deck lives in `DeckWorkspace` state. Import and export go through system file dialogs. Edits persist only through export ([ADR 0005](docs/adr/0005-local-first-storage.md)).
- **Web:** the deck lives in `App` state. Imports and explicit saves are written to `localStorage` when available. A saved value that no longer validates is copied to `qr-song-quiz.deck.v1.unreadable` and offered for download before anything can overwrite it.
- **Games:** the session is an action log replayed by the core after every action, saved after every action (Apple: `Application Support/Eratic/Sessions/current.json` plus a deck snapshot; web: `eratic.session.v1`). Scores are never stored. *Undo* before a reveal removes the last entry (with a guess's own wager) from the log and replays it; a shortened log is still a valid session, and steps, draws and reveals are never removed. Small device-local preferences sit beside it: the last roster (`eratic.roster.v1`), the entry style (`eratic.play.entry.v1`), personal bests per deck (`eratic.bests.v1`) and, natively, an unseen-results marker (`eratic.play.unseen.v1`).
- **Network:** deck editing makes no requests. Selecting playback can reuse a previously authorized provider; without authorization or developer configuration, song links and QR codes remain available. Native Apple Music uses system music permission and the device subscription. Interactive Spotify sign-in and web MusicKit authorization require the separate timed-playback action; ordinary playback, token refresh and stop never initiate Spotify sign-in. Native external song URLs prefer installed music apps, with HTTPS fallback. Browser links use the provider app/site's own session and cannot read a native app's sign-in. No accounts of our own, telemetry, or synchronization. Account-free embeds use recognized provider song URLs. Ordinary song backups load on an explicit preview request; Snippet Ladder preloads one hidden preview when a card is drawn and starts sound only on a step press; Lineup and Original or Imposter keep one hidden preview loaded at a time (the first tile on draw, then the next unplayed tile after each snippet) and switch it when the host plays another tile. Web `playback/embeddedPreview.ts` owns Spotify iframe lifecycle through `public/spotify-preview.html` and its small message bridge (a separate CSP permits the provider loader's eval requirement while the main app stays eval-free) and `ui/game/EmbeddedPreview.tsx` owns the fallback controls; native `Playback/EmbeddedPreview.swift` is a narrow WKWebView bridge with a coordinator and teardown. These remain outside the exact-clip Player contract and create no clip records. Snippet Ladder records its step at preview onset, using approximate provider timing; scoring still comes from the core. Web Host owns the temporary answer-inspection state shared by Ladder inputs and stage, so opening the answer disposes the hidden preview before scoring. Native LadderInput stops its snippet controller at the same transition. See [ADR 0014](docs/adr/0014-app-first-playback.md).

## Where new code goes

- A new deck field or rule: start in `contract/` with a schema change (a new schema version if it breaks compatibility), README text and cases, then implement it in both cores.
- Playlist import: the candidate format and its rules are in [`contract/playlist-candidates.md`](contract/playlist-candidates.md) and `candidate-v1.schema.json`, implemented in both cores (reference parsing, provider page normalization, review issues, promotion to a card). Candidates may lack a reliable year; promotion to a card needs a curated year and source ([ADR 0004](docs/adr/0004-playlist-import-candidates.md), [design](docs/playlist-import.md)). Still planned: provider adapters that fetch pages (beside each core's playback code, passing raw pages to the core unchanged) and the review screens.
- Printing, which is planned: a layout module consumes a validated, ordered deck, explicit QR payload decisions, and print settings. It must not fetch metadata or substitute URLs, and fronts and backs derive from one ordering. Native PDF and browser output can use different renderers while sharing layout fixtures in `contract/`.
- A new game mode or rule: add it to `contract/game-rules.md` with cases first, then both engines, then a mode input in each app (`Sources/Game/Modes`, the web `MODE_UI` registry).
- Synchronization, multi-device play and distribution are separate future capabilities, each needing its own requirements and ADR.

## Build and tooling

How code gets checked and the demo gets published:

```mermaid
flowchart LR
  dev["Developer"] -->|"make check"| make["Makefile"]
  ci["check.yml<br/>(manual, Dependabot PRs)"] -->|"web-check, core-test,<br/>apple-preview-test, apple-build"| make
  audit["dependency-security.yml<br/>(push, PR, weekly)"] -->|"npm audit"| lock["package-lock.json"]
  make -->|"vitest, tsc, vite build"| dist["apps/web/dist"]
  make -->|"swift test, xcodebuild"| appbuild["unsigned app builds"]
  pagesci["pages.yml<br/>(manual, main only)"] -->|"build without credentials"| dist
  dist -.->|"deploy-pages"| pages["GitHub Pages demo"]
```

There is no release pipeline for the Apple app: `make apple-build` only proves it compiles unsigned, and running on a device needs your own signing team. The full CI run is manual (`workflow_dispatch`) except on Dependabot pull requests, so `make check` locally is the usual gate. The demo is deployed only by a manual run of `pages.yml` on `main`, with all `VITE_*` provider settings empty.

Where in the code: [Makefile](Makefile), [.github/workflows/check.yml](.github/workflows/check.yml), [.github/workflows/pages.yml](.github/workflows/pages.yml), [.github/workflows/dependency-security.yml](.github/workflows/dependency-security.yml), [apps/apple/project.yml](apps/apple/project.yml).

The root `Makefile` is the single entry point that CI (`.github/workflows/check.yml`) and developers use. The Xcode project is generated from `apps/apple/project.yml` and is not committed. The Swift package is consumed by path from that spec. The web app is a single npm package with a lockfile. There is no JavaScript workspace or monorepo tooling, because only one JavaScript package exists.

The web npm commands generate standalone AJV validators from the five canonical schemas (deck-v1, deck-v2, session-v1, session-v2 and candidate-v1) before dev, tests, typechecking and builds. `scripts/generate-validators.mjs` bundles them and AJV's runtime helpers into ignored `src/core/generated/validators.js`; the core imports this ESM module with checked-in declarations. Compilation runs in Node, never in the browser, preserving the production CSP's ban on dynamic code evaluation. Contract changes during a running dev session require regeneration or a dev-server restart. The schemas and validation rules remain the shared source of truth.

`script/build_and_run.sh` is the native Mac launch entry point. It regenerates the same Xcode project, builds with the macOS settings from `make apple-build`, and launches the app bundle; optional flags verify the process or attach logs/debugging.
