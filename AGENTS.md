# Eratic — agent guide

Eratic: a native SwiftUI app (Mac, iPad, iPhone) and an independent static web app that exchange one versioned JSON deck format and host the same nine game modes, scored by the same contract rules. "Universal" means native **Mac, iPad and iPhone**. The web app must keep working without the Apple app, an account or a backend.

## Map

| Path | What lives there |
| --- | --- |
| `contract/` | Canonical contract: `deck-v1`/`deck-v2`/`session-v1`/`session-v2`/`candidate-v1` schemas, rules in `README.md`, game rules in `game-rules.md`, playlist review candidates in `playlist-candidates.md`, era bounds in `eras.json`, `demo-deck.json`, and `cases/*.json`, which both apps' tests run |
| `apps/apple/EraticCore/` | Foundation-only Swift core: `Deck.swift` (models, curation, v2 fields), `StrictJSON.swift`, `DeckCodec.swift`, `CardURLs.swift` (URL policy, QR route), `EraTokens.swift`/`EraBoundaries.swift` (eras), `Random.swift`, `Scoring.swift`, `Scan.swift`, `Session.swift`/`SessionCodec.swift`, `GameEngine.swift`/`GameModes.swift`/`GameQueries.swift` (rules engine), `Playlist.swift` (playlist candidates) |
| `apps/apple/Sources/` | SwiftUI app shared by the macOS and iOS targets: deck workspace, `Game/` (Play surface), `Playback/` (Spotify, Apple Music, manual, calibration), `Scanner/`; `project.yml` generates the Xcode project |
| `apps/web/src/core/` | TypeScript mirror of the Swift core (`deck.ts`, `cardUrls.ts`, `random.ts`, `eras.ts`, `scoring.ts`, `scan.ts`, `session.ts`, `playlist.ts`, `game/`); no React, DOM or storage |
| `apps/web/src/ui/`, `storage.ts`, `sessions.ts`, `qrSvg.ts`, `playback/`, `scanner/` | React UI (`ui/game/` is the Play surface), deck and session persistence, QR SVG rendering, provider adapters, camera scanning |
| `design/eras.json` | Presentation tokens for the nine eras (bounds live in `contract/eras.json`), read by both apps (web `src/ui/eras.ts`; Apple `EraTokens.swift` validates and joins, `Sources/Era.swift` maps to SwiftUI) |
| `docs/` | `STATUS.md` (state and next steps), `ATTRIBUTION.md`, `playlist-import.md`, `adr/` |
| `private/` | Ignored local archive; never publish its contents or historical Git refs |

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing boundaries or data flow, and [contract/README.md](contract/README.md) before touching validation.

## Commands

- `npm --prefix apps/web ci`: install locked web dependencies.
- `make web-check`: web tests (contract cases, storage, architecture rule, UI workflows in jsdom), then `tsc` and the Vite build.
- `make web-dev`: local dev server.
- `make check`: `web-check` plus `core-test`.
- `make core-test`: `swift test` for EraticCore, including all contract cases.
- `make apple-preview-test`: macOS regression harness for native preview recovery, using the actual player source and AVFoundation with controlled inputs.
- `make apple-project`: generate the ignored Xcode project.
- `make apple-build`: unsigned macOS and generic iOS Simulator builds.

In a macOS Seatbelt-sandboxed agent session, `swift test`, `xcodegen` and `xcodebuild` fail, and SwiftUI's `@State` macro plugin can't run, so `swiftc -typecheck` of the app needs a workaround; prefer `ObservableObject` and avoid `@Observable`/`#Preview` in new code. They need to write to `/var/folders/…/T/TemporaryItems`, and SwiftPM nests `sandbox-exec`. Ask the user to run them, or to allow that path. Don't report them as passing on the strength of substitute checks.

## Rules

- **Contract changes** touch, in one change: `contract/` (the schema, README rules, and a case for every new or changed rule), both cores, and both test suites. Run `make web-check` and `make core-test`. A breaking change needs a new schema version and a migration.
- **Game rule changes** follow the same path: `contract/game-rules.md` and a case for every new or changed rule, then both engines and both suites. Compare IDs and member names exactly (Swift `utf8`, TypeScript `Map`/`Object.hasOwn`).
- Keep deck and game rules in the cores. UI code calls them; it doesn't re-implement them or compute scores. Web `src/core` must not import UI, React or browser APIs; `src/core/architecture.test.ts` enforces this.
- Never change the browser storage key `qr-song-quiz.deck.v1` or its quarantine key without a migration, because they hold users' data. They keep the pre-Eratic name on purpose (ADR 0009), as do the schema's `$id` and title. The same applies to the game keys `eratic.session.v1` (+ `.unreadable`, `.deck`), `eratic.daily.v1`, `eratic.play.prefs.v1`, `eratic.calibration.v1`, `eratic.spotify.auth.v1`, `eratic.roster.v1`, `eratic.play.entry.v1` and `eratic.bests.v1` (web localStorage and native UserDefaults), and `eratic.play.unseen.v1` (native UserDefaults and web localStorage).
- Era styling is presentation only: it follows a card's curated year and never changes deck data. Change era tokens in `design/eras.json` only; `src/ui/eras.test.ts` checks coverage and contrast. QR codes stay black on white.
- Curated game years require a source. Keep stable card IDs separate from provider metadata and release dates.
- Supplied official-card URLs stay unverified. Never infer official-app compatibility from a QR's appearance or syntax, and never fabricate official identifiers.
- Do not advertise original HITSTER-card support or official-app compatibility in public product copy or roadmaps. Describe scanning as selecting cards in a loaded user-curated deck; private catalogue experiments are not a public feature (ADR 0013).
- Keep playlist fetching, candidate review, curation, QR route selection and print rendering separate. Plan for both Spotify and Apple Music.
- Keep the comments that credit upstream design ideas next to the code they describe, and update `docs/ATTRIBUTION.md` when an idea is adopted. Copying code requires recording its source revision, licence and notices first.
- Local APKs, decompiled code, catalogue blobs, credentials, user decks, and build or QA output stay out of Git and out of app bundles (see `.gitignore`).
- Do not add co-author trailers to commits. Publish only the public `main` branch; never push private/archive branches or mirror all refs.
- When capabilities or next steps change, update `docs/STATUS.md`. For a boundary change, update `ARCHITECTURE.md`; for an interaction change, `DESIGN.md`; for a consequential decision, add an ADR. Keep implemented features, plans and unverified claims distinct.

## Working together

The user owns commits and outward-facing publication, and sets scope. The agent the user starts (Codex or Claude Code) implements. Cross-agent review is opt-in: hand work to the other agent only when the user asks for it in the current task; internal reviewer subagents do not replace a requested cross-agent review, and an implementer never accepts its own work under such a review. Before editing, read `.agents/handoff.md` and `git status`, and preserve work you did not make. Allow one editor per checkout; use separate checkouts with disjoint ownership for parallel changes. `.agents/handoff.md` is gitignored; record in it the status (`in-progress`, `complete`, `ready-for-review` only when a review was requested, `changes-requested`, `accepted`), date, goal, files changed, checks with exit codes, and open questions.
