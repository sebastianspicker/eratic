# Eratic

*Spelled wrong. Dated right.*

[Try the web demo](https://sebastianspicker.github.io/eratic/) · [Game modes](docs/game-modes.md)

Eratic is a music year quiz built from cards you curate. A native SwiftUI app for **Mac, iPad, and iPhone** and a **standalone web companion** prepare the decks and their QR cards, then host the games, and every era gets its own style: a song from 1984 looks like the eighties, one from 1997 like a photocopied zine. Both applications read and write the same versioned JSON deck files. The web companion works without the Apple app, an account, or a backend.

Current scope:

- **Deck:** import and export a deck, select a card, curate its answer year and evidence, set the optional game fields (clip start, difficulty, related recording), and preview an explicitly chosen QR route.
- **Play:** nine [game modes](docs/game-modes.md) — Timeline, Bullseye, Era Sort, Snippet Ladder, Higher or Lower, Relay, Lineup, Daily Eratic, Original or Imposter — on one host device, drawing cards from the deck or scanning printed cards with the camera, with Spotify or Apple Music playback (or "play it yourself" without an account). Both apps compute the same scores from the same [rules](contract/game-rules.md).

The bundled songs and example.com links are fictional. Live playlist import and print-ready output are planned, not implemented. Provider playback needs your own Spotify app registration and MusicKit setup, and none of it has been tried against live accounts yet. See [status](docs/STATUS.md).

Playing arbitrary custom songs through the unmodified official Hitster app is still an unresolved product requirement. Supplied official-card URLs are treated as **unverified mappings**. The direct provider-link preview has to be chosen explicitly, and it does not claim official-app compatibility.

## Run it

Web companion (Node.js `^22.13 || ^24 || >=26`):

```sh
npm --prefix apps/web ci
make web-dev        # local dev server
make web-check      # tests, type check, production build into apps/web/dist
make check          # web-check + core-test
```

The build is a static site; serve `apps/web/dist` from any static host. Optional build-time settings, all empty by default: `VITE_SPOTIFY_CLIENT_ID` (Spotify playback; register the deployed URL as a redirect URI), `VITE_MUSICKIT_DEVELOPER_TOKEN` (Apple Music; a developer token you mint offline — never the signing key), `VITE_ERATIC_CARD_HOSTS` (the Eratic card QR domain, once one is chosen).

Apple app (macOS with full Xcode and [XcodeGen](https://github.com/yonaskolb/XcodeGen); deployment targets macOS 14 and iOS/iPadOS 17):

```sh
make core-test      # Swift core tests, including the shared contract cases
make apple-project  # generate the ignored apps/apple/Eratic.xcodeproj
make apple-build    # unsigned macOS and generic iOS Simulator builds
```

Open the generated project and run `Eratic-macOS`, or run `Eratic-iOS` on an iPhone or iPad simulator. Running on a device needs your own signing team. Spotify playback needs `AppConfig.spotifyClientID` set (`apps/apple/Sources/Playback/AppConfig.swift`) and the redirect `eratic://spotify-callback` registered; Apple Music needs the MusicKit app service enabled for your bundle IDs. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup and conventions.

## Repository map

| Path | Responsibility |
| --- | --- |
| [`contract/`](contract/README.md) | The shared contract: deck and session JSON Schemas, explicit validation rules, the game rules, era boundaries, the fictional sample deck, and the cases both apps must pass |
| `apps/apple/` | SwiftUI app for Mac, iPad and iPhone (`Sources/`), its Foundation-only core package (`EraticCore/`), and the XcodeGen spec |
| `apps/web/` | React/TypeScript static web companion; `src/core/` mirrors the Swift core (including the rules engine), `src/playback/` and `src/scanner/` talk to providers and the camera, `src/ui/` holds the interface |
| [`design/`](design/eras.json) | Presentation tokens both apps read: the nine era styles |
| `docs/` | Project status, attribution, the playlist-import design, and decision records |

## Documentation

| Document | Use it for |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Components, boundaries, dependency direction, where new code goes |
| [DESIGN.md](DESIGN.md) | Interaction model, visual tokens, platform behaviour, accessibility |
| [docs/STATUS.md](docs/STATUS.md) | What works, what has been verified, what's next, open decisions. **Start here when resuming.** |
| [contract/README.md](contract/README.md) | File format semantics and validation rules |
| [docs/adr/](docs/adr/README.md) | Why consequential choices were made |
| [docs/playlist-import.md](docs/playlist-import.md) | Spotify and Apple Music import design (planned) |
| [docs/game-modes.md](docs/game-modes.md) | Current overview of the nine modes and their playback requirements |
| [contract/game-rules.md](contract/game-rules.md) | The exact rules both apps compute: scoring, sessions, scanning, deck version 2 |
| [docs/ATTRIBUTION.md](docs/ATTRIBUTION.md) | External projects whose ideas informed this one |

Historical research and superseded plans are kept in an ignored local archive and are not required to build either app. See [publication boundaries](docs/adr/0012-public-repository-and-private-archive.md).

## Attribution and licence

The code is written for this repository. It adapts design ideas from the projects credited in [the attribution map](docs/ATTRIBUTION.md) but copies none of their code. The [attribution map](docs/ATTRIBUTION.md) distinguishes adopted ideas, planned improvements, and practices we avoided. Playlist-to-card generation inspired by [Digibitz](https://www.digibitz.nl/hitster-kaarten/) is part of the [playlist import plan](docs/playlist-import.md).

No distribution licence has been chosen for this project's own code yet. Upstream inspiration does not grant one, nor any rights to song metadata or artwork. Dependency licences remain separate.
