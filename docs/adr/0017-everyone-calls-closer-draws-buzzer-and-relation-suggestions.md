# ADR 0017 Higher or Lower for everyone, closer draws, a Ladder buzzer and linked-recording suggestions

Date: 2026-10-11. Status: accepted by the user.

## Context

A review of the nine modes found three game-design gaps. In versus Higher or Lower only the active player plays, and an eliminated player sits out the rest of the game. Calls are often trivial, because a reference near the edge of the deck's years makes one answer almost certain. In Snippet Ladder, players who lock at the same step tie, so being first to know the song earns nothing. Separately, Original or Imposter is usually unavailable because linking recordings by hand is tedious. The user approved changing the rules for all of these.

## Decision

- **Higher or Lower `play: everyone`** with `lives` (1–5, default 3). Every player still in calls every card; a miss costs a life, and at 0 lives the player is out. The streak counts correct calls. `play: turns` stays the default and is unchanged.
- **Higher or Lower `closer`**: the apps draw with `closerPick`, which picks the first unused card in draw order within `max(3, 20 − 2 × revealed)` years of the reference (never the same year when avoidable), so the game gets harder as it goes. The engine does not check how a card was drawn, as before.
- **Snippet Ladder `buzzer`**: the first player to lock who scores on the card gains 2 more points. Wagers settle on the points before the bonus.
- The options are new optional members of session version 2. Existing version 2 files keep their meaning, because every option defaults to the old behaviour, so no new session version is needed. Version 1 sessions reject the new options. An older app rejects a session that uses them, as it would reject any unknown option.
- **`suggestRelations`**: both cores propose `relatedTo` links between cards whose normalized titles match. The earliest card is the original. The relation is `remasterOf` when the artists match and `coverOf` otherwise. Suggestions are never applied without the host's confirmation, and they are never presented as curated facts.

## Consequences

Both cores, both suites and the shared cases carry the new rules. The setup screens offer the options in plain words. Title matching is heuristic: songs that share a title, such as two different songs called "Hello", are suggested and must be rejected by the host.

## Alternatives considered

Giving eliminated players a side task keeps turns but still leaves them out of the main game. A per-player draw window for closer draws would need per-player cards, which conflicts with one shared reference card. Scoring Ladder by lock order alone would change the meaning of existing sessions. Linking recordings automatically on import would turn heuristics into deck data.

## Revisit

If players find `everyone` games too long (raise the default `cards`), or if title matching produces too many false suggestions.
