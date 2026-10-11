# ADR 0016 Session version 2 caps Snippet Ladder steps at 30 s

Date: 2026-10-11. Status: accepted by the user.

## Context

Without exact clips, Snippet Ladder plays its steps as snippets of the provider's hidden preview, which lasts about 30 seconds ([ADR 0014](0014-app-first-playback.md)). Version 1 sessions allow steps up to 600 s and default to `[1000, 5000, 10000, 30000, 60000]`, so the default game could not be played from previews. The user decided that 30 s is the maximum step. Tightening the version 1 rule would make saved and exported games with a 60 s step (every default Snippet Ladder game) unreadable.

## Decision

Introduce `session-v2`: identical to version 1 except that Snippet Ladder `steps` range from 500 to 30000 ms, with default `[1000, 5000, 10000, 20000, 30000]`. It keeps five steps, so `ladderPoints` and its 10/8/6/4/2 scale are unchanged. Both apps create version 2 sessions. Version 1 sessions stay readable and replay under the version 1 rules, including the old default, and are written back unchanged as version 1. Storage keys don't change.

## Consequences

Both cores, schemas and contract cases carry two session versions. A version 1 game can't be converted into version 2 without changing its scores, so there is no rewriting migration: version 1 is simply still read. The setup offers steps of 30 s at most. A preview-only account still drops steps longer than its preview. Lineup's `clipMs` (up to 60 s) is unchanged.

## Alternatives considered

Tightening version 1 in place would quarantine existing games. Capping only in the setup screens would leave the rules engine accepting 60 s steps in new sessions, contrary to the decision. Dropping to four steps would have changed the point scale.

## Revisit

If providers' previews get longer or shorter, or exact clips become the norm again.
