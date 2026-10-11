# ADR 0010 Own scanner and player, with Spotify and Apple Music playback

Date: 2026-10-11. Status: accepted by the user (product direction); implemented, with the engineering choices recorded in [ADR 0011](0011-game-rules-contract-and-sessions.md) (notably Spotify Web API control on Apple instead of the iOS SDK). The current [mode overview](../game-modes.md), [design](../../DESIGN.md) and [game contract](../../contract/game-rules.md) replace the original implementation ledger.

## Context

The game modes need audio under the game's control: timed snippets of 1/5/10/30/60 s, clips for Lineup, and timeline rounds. The repository had left "scanner and independent gameplay" as an open decision ([STATUS](../STATUS.md)). It had also recorded provider-terms concerns: Spotify's Developer Policy text on games ([playlist-import.md](../playlist-import.md)), and Apple's MusicKit licence wording on full-song playback.

## Decision

- **Scanner and player.** Eratic builds its own scanner and player into the Apple app and the web app. The scanner resolves a card through the host's loaded deck, in the order specified in the game contract. A new provider-independent Eratic card QR route is proposed for this, with its domain still to be decided.
- **Spotify playback:** the Web Playback SDK with the Web API on the web; on Apple, Web API control of the user's Spotify app (ADR 0011 replaced the originally planned iOS SDK App Remote).
- **Apple Music playback:** MusicKit and MusicKit JS.
- **Mode availability** depends on each user's account tier, which is detected at session start (see DESIGN.md and ADR 0011).
- **Provider terms.** The owner's assessment is that this use is permitted, by analogy with the commercial game Hitster, which offers Spotify-driven play with the same mechanics. The owner directed that provider terms are not treated as design blockers. The policy texts quoted in earlier research remain in the linked sources for reference.
- **Engineering prerequisites** remain as tasks: Spotify app registration and extended access beyond development mode, MusicKit setup, and an Apple Music web developer token.

## Consequences

- **Order of work.** The game modes become buildable in waves, with the foundations first: rules engine, session format, player adapters and scanner.
- **No account-free play.** Game playback now depends on the users' Spotify or Apple Music accounts. JSON deck editing stays account-free.
- **Apple Music on the web** needs a signed developer token, but the web app has no backend. ADR 0011 resolves this with an optional build-time developer token; no signing key ships in the web app.
- **Contract change.** The proposed Eratic card QR route needs an addition to the contract's QR route modes and a case for it.
- **Responsibility.** Compliance with provider terms is the owner's responsibility under this decision. If a provider's app review or extended-access review refuses the use, revisit this ADR.

## Alternatives and revisit condition

- **Bring your own playback.** The QR opens the provider's app, so the game has no timed clips. This was rejected because the snippet modes are core to the product.
- **User-owned local files only.** Rejected: it doesn't match how people listen.

Revisit if Spotify or Apple deny registration, extended access or app review, or if the terms change.
