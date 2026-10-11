# Eratic for Mac, iPad and iPhone

One SwiftUI source tree targets macOS 14+, iOS 17+ and iPadOS 17+. XcodeGen generates the Xcode project from `project.yml`; the project is not committed. Run these from the repository root:

```sh
make core-test       # swift test --package-path apps/apple/EraticCore
make apple-project   # xcodegen generate --spec apps/apple/project.yml
make apple-build     # unsigned macOS and generic iOS Simulator builds
./script/build_and_run.sh --verify # rebuild/launch Mac app and verify its process
```

Use your own bundle identifiers and development team for signed or device builds.

The run script stops the existing Eratic process before rebuilding; export unsaved deck edits first. It also accepts `--debug`, `--logs` and `--telemetry`. The ignored local Codex Run action can point to `./script/build_and_run.sh`.

## Layout

| Path | Responsibility |
| --- | --- |
| `EraticCore/` | Foundation-only Swift package. `Deck.swift`: models and `updatingGameYear` curation. `DeckCodec.swift`: strict decoding, encoding, validation, 8 MiB limit. `CardURLs.swift`: contract URL rules, `QRMode`, `QRRoute`. `EraTokens.swift`: decodes and validates `design/eras.json`. |
| `Sources/` | SwiftUI app: workspace and file dialogs, card detail with year editor, Core Image QR preview, display labels; `Era.swift` and `EraViews.swift` decode `design/eras.json` and draw the wordmark, year chips and the era hero |
| `project.yml` | macOS and iOS app targets, both depending on `EraticCore` by path and bundling `contract/demo-deck.json` and `design/eras.json` |

The core tests find `contract/` by walking up from the test source, and they run every case file in it. To build the package outside this repository, include `contract/`.

## Behaviour notes

- Deck edits are held in memory until you export. Games save their action log and deck snapshot automatically for resume.
- Import and export use `fileImporter`, `fileExporter` and `FileDocument`.
- Official-card mode is the default. It previews only a supplied recognized URL, labelled **Supplied mapping — unverified**. Direct-link mode encodes the chosen provider URL exactly.
- Play hosts all nine game modes, camera QR scanning, Spotify/Apple Music playback and manual playback. Provider configuration and live-account checks are still required; see the root README and [status](../../docs/STATUS.md).
- There is no live playlist fetch, backend or PDF export.

Design-idea attribution is kept in comments next to the code and in [docs/ATTRIBUTION.md](../../docs/ATTRIBUTION.md).
