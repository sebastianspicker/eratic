# ADR 0011 Game rules as a shared contract, session files, deck version 2

Date: 2026-10-11. Status: implemented (agent decision following the user's direction to build the ledger; the product decisions it rests on are in [ADR 0010](0010-own-scanner-and-streaming-playback.md)).

Provider availability and sign-in behavior are amended by [ADR 0014](0014-app-first-playback.md): QR/app-link playback is always available; interactive timed-playback authorization is optional.

## Context

The original game-mode ledger proposed nine modes, modifiers and tie-breaks; its maintained [overview](../game-modes.md) now links to the contract and design. Both apps must score them identically: a game hosted on an iPad and replayed in a browser must give the same standings. The deck format already solved the same problem with written rules plus executable cases that both cores run ([ADR 0002](0002-versioned-deck-contract.md), [ADR 0008](0008-explicit-text-and-url-rules.md)). The ledger also left questions open (Q1–Q8) that the build needed answered.

## Decision

- **Rules as a contract.** [`contract/game-rules.md`](../../contract/game-rules.md) is the executable specification: determinism (FNV-1a, mulberry32, Fisher–Yates, code-point order), eras, scoring primitives, the session file, the rules engine for every mode with wagers and sudden death, the summary shape, scan resolution, provider track identity, the Eratic card route and deck version 2. The contract supersedes the archived implementation ledger. Both cores implement it as pure functions, independently, and both run every case in `contract/cases/game-*.json`, `session-files.json`, `scan-resolution.json` and `provider-tracks.json`.
- **Sessions are action logs.** A `session-v1` file records mode, options, seed, players and timestamped actions with card snapshots; scores are always recomputed by replaying, never stored. Strict JSON as for decks, 2 MiB. Storage is device-local: `eratic.session.v1` in the browser (with the deck-style quarantine), `Application Support/Eratic/Sessions/current.json` on Apple.
- **Era boundaries moved to the contract** (ledger Q3): `contract/eras.json` holds IDs, names and year bounds; `design/eras.json` keeps only presentation and lists the same IDs in order. Both apps test the match.
- **Deck version 2** adds optional `clip.startMs`, `defaultClipStartMs`, `relatedTo` and `difficulty`. Version 1 still rejects them. Export keeps the deck's version; an app migrates a deck only when the user sets a version-2 field, and says so. Both versions share the browser storage slot.
- **Ledger questions answered by the build:**
  - Q1 (Eratic card QR domain): the route is implemented and tested with a configurable host, but no build configures one until a domain is registered (`AppConfig.eraticCardHosts`, `VITE_ERATIC_CARD_HOSTS`).
  - Q2 (Apple Music on the web): MusicKit JS is enabled only when the build is given a developer token (`VITE_MUSICKIT_DEVELOPER_TOKEN`), minted offline; the signing key never ships. Without one, the web offers Spotify and "play it yourself".
  - Q4: 150 ms target, measured by an in-app calibration run per provider, which warns but never blocks.
  - Q5: locks are taken on the host device in tap order.
  - Q6: Timeline defaults N = 10, challenges on, two tokens.
  - Q7 stays out of scope. Q8: Daily ships in both apps, because Bullseye and Era Sort ship natively too.
- **Spotify on Apple uses the Web API**, controlling the user's Spotify app as a Connect device (Authorization Code with PKCE through `ASWebAuthenticationSession`, tokens in the Keychain), instead of the iOS SDK's App Remote. It works on macOS as well and needs no binary SDK. Spotify Free accounts get "play it yourself", because the Web API can't start playback for them.

## Consequences

- A rule exists once it has a case; parity between the cores is checked continuously instead of by inspection. The first runs found and fixed several differences, including prototype-named player IDs in TypeScript and Unicode canonical equivalence in Swift.
- Changing an era boundary changes scores and invalidates recorded sessions; it needs a new session version.
- An older app keeps a version-2 deck aside as unreadable rather than overwriting it.
- The Spotify Connect approach depends on an active Spotify device and adds network latency to the audible-start estimate; the calibration run measures whether the 150 ms target holds.

## Alternatives

- **Share one engine** (for example TypeScript in a web view, or Swift compiled to WebAssembly): rejected; the repository's two-core, one-contract design keeps both apps native and independent.
- **Store scores in sessions:** rejected; a log that is replayed can't disagree with itself.
- **Spotify iOS SDK App Remote:** deferred; it only covers iOS and needs a binary SDK. Revisit if Web API control proves too slow in calibration.

## Revisit

When a domain is chosen for the Eratic card QR (Q1), when Apple Music on the web needs tokens refreshed without a rebuild, or when calibration shows a provider can't meet the clip-timing target.
