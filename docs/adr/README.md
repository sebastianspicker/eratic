# Architecture decision records

ADRs retain the reasons for consequential choices so a later session can continue without reconstructing the conversation. “Implemented” records that the decision is reflected in the code; it does not mean the user has accepted it. User-selected requirements are identified explicitly.

| Record | Decision | Status |
| --- | --- | --- |
| [0001](0001-apple-and-standalone-web.md) | Native Mac/iPad/iPhone app and standalone web companion | Platform requirement chosen by user; implemented |
| [0002](0002-versioned-deck-contract.md) | Shared versioned JSON contract with independent native/web validators | Implemented; amended by 0007, 0008 |
| [0003](0003-explicit-qr-routes.md) | Explicit QR routes and unverified official mappings | Implemented |
| [0004](0004-playlist-import-candidates.md) | Spotify and Apple Music adapters produce review candidates | Candidate model implemented; fetching and review screens planned |
| [0005](0005-local-first-storage.md) | Local operation and file interchange before synchronization | Implemented |
| [0006](0006-provenance-and-repository-boundaries.md) | Track source provenance; exclude local research/private artifacts | Implemented |
| [0007](0007-repository-layout.md) | Repository layout follows ownership; one home per concept | Accepted |
| [0008](0008-explicit-text-and-url-rules.md) | Explicit text and URL rules shared by both validators | Accepted; amends 0002 |
| [0009](0009-eratic-brand-and-eras.md) | Product name Eratic and the nine-era design system | Accepted by the user; implemented |
| [0010](0010-own-scanner-and-streaming-playback.md) | Own scanner and player; Spotify and Apple Music playback for game modes | Accepted by the user; implemented (see 0011) |
| [0011](0011-game-rules-contract-and-sessions.md) | Game rules as a shared contract, session files, deck version 2, ledger questions answered | Implemented |
| [0012](0012-public-repository-and-private-archive.md) | Public source and Pages demo; historical research and ledgers remain private | Implemented |
| [0013](0013-public-card-support-positioning.md) | Do not advertise original HITSTER-card support or official-app compatibility | Accepted by the user; documentation updated |
| [0014](0014-app-first-playback.md) | Reuse authorization, prefer installed music apps and keep credential-free QR/link fallback | Implemented; live provider/device verification remains open |
| [0015](0015-mit-licence.md) | License the project's own code under MIT | Accepted |
| [0016](0016-session-v2-ladder-step-cap.md) | Session version 2 caps Snippet Ladder steps at 30 s | Accepted |
| [0017](0017-everyone-calls-closer-draws-buzzer-and-relation-suggestions.md) | Higher or Lower for everyone, closer draws, a Ladder buzzer and linked-recording suggestions | Accepted |

## Add or change a decision

Create the next numbered Markdown file with a clear title, date, status, context, decision, consequences, alternatives considered, and a condition for revisiting it. Link relevant code and primary evidence. If a decision changes, add a superseding record and link both directions. Correct factual errors in place; retain the original rationale when documenting a different choice.

Keep ordinary task status in [STATUS.md](../STATUS.md) and local `.agents/handoff.md`. ADRs should not become a chronological tool log or substitute for issue tracking.

