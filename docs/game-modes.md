# Game modes

All nine modes are implemented in the native Mac/iPad/iPhone app and the independent web companion. One device hosts the room; each player entry can represent a person or a team where the group shares a guess. Play from the loaded deck or use the camera for modes that accept individual scanned cards.

This is a product overview. Exact scoring, defaults, modifiers and tie-breaks live in [the game contract](../contract/game-rules.md); controls and accessibility behavior live in [DESIGN.md](../DESIGN.md#play-interaction-model). Verification and outstanding decisions live in [STATUS.md](STATUS.md).

| Mode | Players | What you do | Playback requirement |
| --- | --- | --- | --- |
| Snippet Ladder | 1–8 | Identify a song from progressively longer clips; earlier answers score more. | Exact clips, or self-stopping snippets of the hidden preview (by hand from the QR when no preview exists); steps are at most 30 s |
| Timeline | 2–8 | Place songs in year order on personal or shared timelines; optional challenges can win a misplaced card. | Manual playback supported |
| Bullseye | 1–10 | Guess the year; closer guesses score more. | Manual playback supported |
| Era Sort | 1–10 | Choose one of nine musical eras; Kids can award adjacent-era credit. | Manual playback supported |
| Higher or Lower | 1–6 | Decide whether the next song is earlier or later and build a streak. | Manual playback supported |
| Relay | 2–10, cooperative | Build one timeline together before the team runs out of lives. | Manual playback supported |
| Lineup | 1–6 | Put a set of songs in chronological order. | Exact clips, or **Lineup by name** without them |
| Daily Eratic | 1 | Play three era rounds and two year rounds, then share the result. Available in both apps. | Manual playback supported |
| Original or Imposter | 2–8 | Hear two related recordings and identify the original. | Linked recordings in a version-2 deck; exact clips, or by hand from the song backup |

Name It, Stakes, Sudden Death and Kids are available where the [contract's mode options](../contract/game-rules.md) specify them. Availability also depends on deck size, linked recordings and the connected playback tier. Unavailable modes show a reason.

The bundled deck is fictional and its links are not playable songs. Import a curated deck for a real game. Neither scanning nor a correctly shaped QR proves compatibility with an official third-party app.

The original implementation ledger, build-wave estimates and historical research are retained only in the maintainer's local private archive. Current decisions are preserved in [ADR 0011](adr/0011-game-rules-contract-and-sessions.md); the archive is not needed to build or use Eratic.
