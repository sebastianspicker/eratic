# Contributing

Start with [README.md](README.md) and [ARCHITECTURE.md](ARCHITECTURE.md). Before editing, check `git status --short` and the local `.agents/handoff.md`, and preserve changes from other contributors.

## Setup

- **Web:** Node.js `^22.13 || ^24 || >=26` (CI uses 22) and npm. Run `npm --prefix apps/web ci`.
- **Apple:** full Xcode with a macOS/iOS SDK, and XcodeGen 2.44 or later. The Swift package declares tools version 5.9; the code was last checked with Xcode's Swift 6.4 compiler.
- No provider credentials are needed for deck editing, the tests, or playing with "Play it yourself". Spotify and Apple Music playback need your own app registration: `VITE_SPOTIFY_CLIENT_ID` / `VITE_MUSICKIT_DEVELOPER_TOKEN` for the web (in an ignored `.env.local`), `AppConfig.spotifyClientID` and the MusicKit app service for Apple. Never commit tokens or keys.

```sh
make web-check     # web tests, type check, production build
make core-test     # Swift core tests
make apple-build   # generates the Xcode project, then unsigned macOS + iOS Simulator builds
```

`make apple-project` generates `apps/apple/Eratic.xcodeproj`. It is ignored, so edit `apps/apple/project.yml` and regenerate. Don't change bundle identifiers or signing settings on another developer's behalf; local builds use `CODE_SIGNING_ALLOWED=NO`.

## Making a change

- Deck and game rules belong in the two cores (`apps/apple/EraticCore`, `apps/web/src/core`), UI belongs in the app layers, and provider integrations live in their own modules (`Sources/Playback`, `src/playback`) ([ARCHITECTURE.md](ARCHITECTURE.md#where-new-code-goes)).
- **A contract change** updates the relevant schema (`deck-v1`, `deck-v2`, `session-v1`, `candidate-v1`) and `contract/README.md` or `contract/game-rules.md`, adds cases under `contract/cases/`, implements the rule in Swift and TypeScript, and runs both suites. Bump the schema version for a breaking change.
- Preserve stable card IDs, optional provider metadata, and year provenance through edits and export.
- Record consequential decisions as a new numbered [ADR](docs/adr/README.md). Supersede old decisions explicitly; don't rewrite them.
- Update the [attribution map](docs/ATTRIBUTION.md) when adopting an external project's idea. Before copying code, record its source, revision, licence and notices; conceptual attribution is not enough.
- Keep historical research and superseded plans in ignored `private/`; preserve current requirements in the contract, design or status docs. Never publish archive refs or Git bundles. Do not add co-author trailers to commits.
- Keep private decks in ignored `data/`, exports in ignored `exports/`, and temporary QA output in ignored `artifacts/`.

## Review

For UI work, exercise the changed workflow in a browser or the Apple app; a successful compile does not verify UI. Don't treat the fictional example.com destinations as playable tracks. Update [docs/STATUS.md](docs/STATUS.md) when capabilities or verification change. The user owns commits and publication. Never commit credentials, research binaries, generated output, or `.agents/handoff.md`.
