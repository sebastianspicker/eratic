# Eratic

*Spelled wrong. Dated right.*

[Try the web demo](https://sebastianspicker.github.io/eratic/) · [Game modes](docs/game-modes.md)

Eratic is a music year quiz built from cards you curate. A native SwiftUI app for **Mac, iPad, and iPhone** and a **standalone web companion** prepare the decks and their QR cards, then host the games, and every era gets its own style: a song from 1984 looks like the eighties, one from 1997 like a photocopied zine. Both applications read and write the same versioned JSON deck files. The web companion works without the Apple app, an account, or a backend.

Current scope:

- **Deck:** import and export a deck, select a card, curate its answer year and evidence, set the optional game fields (clip start, difficulty, related recording), and preview an explicitly chosen QR route.
- **Play:** nine [game modes](docs/game-modes.md) — Timeline, Bullseye, Era Sort, Snippet Ladder, Higher or Lower, Relay, Lineup, Daily Eratic, Original or Imposter — on one host device, drawing cards from the loaded deck or scanning QR codes linked to its cards, with Spotify or Apple Music playback (or "play it yourself" without an account). Both apps compute the same scores from the same [rules](contract/game-rules.md).

The bundled songs and example.com links are fictional. Live playlist import and print-ready output are planned, not implemented. Without any account or setup, every card shows its song's QR code and link, and single-card rounds can play the provider's short preview from a hidden player; this works in Chrome with Spotify and Apple Music but is not yet verified on devices. Timed clips need your own Spotify app registration and MusicKit setup and have not been tried against live accounts. See [status](docs/STATUS.md).

## Music, artists and legal notes

**Support the artists.** If the game brings back songs you love or introduces new ones, please listen with a paid Spotify Premium or Apple Music subscription, or buy the music, so artists and songwriters get paid.

- **No music is hosted here.** This repository and the apps contain no recordings, artwork or song catalogues. Audio and previews are streamed directly from Spotify or Apple Music through their public players and interfaces, subject to their terms. Song links and years in a deck are entered by its user.
- **Your use is your responsibility.** Follow the terms of the music service you use. Playing music in public or commercially, for example at an event or venue, may need a performance licence from a collecting society (in Germany, GEMA).
- **No affiliation.** Eratic is an independent project, not affiliated with or endorsed by Spotify, Apple or the makers of HITSTER. Their names and trademarks belong to their owners and are used only to identify their services.
- **No warranty.** The software is provided as is, without warranty. This section is not legal advice.

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

The project's own code is released under the [MIT License](LICENSE) ([ADR 0015](docs/adr/0015-mit-licence.md)). It grants no rights to song recordings, metadata, artwork or third-party trademarks. Dependencies and the bundled typeface keep their own licences.
