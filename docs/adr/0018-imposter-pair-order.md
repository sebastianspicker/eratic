# ADR 0018 Original or Imposter draws pairs with a no-repeat order

Date: 2026-10-17. Status: accepted by the user.

## Context

A "hub" original with several covers yields several pairs that share that card. Both apps drew the next unplayed pair in `imposterPairs` order, so the hub could appear in consecutive rounds, and the repeated song gave the answer away.

## Decision

Add the pure primitive `nextImposterPair(pairs, drawn)` ([game-rules.md](../../contract/game-rules.md) section 1.5): the first unplayed pair that shares no card ID with the last drawn pair, else the first unplayed pair. Both apps draw with it. Contract cases in `game-primitives.json` pin it, and both suites run them.

## Consequences

The engine never checked how a pair was chosen, so no engine rule, session format or session version changes. Saved sessions replay unchanged. Games in progress may draw a different next pair than before. When only pairs sharing a card with the last pair are left, the hub still repeats.

## Alternatives considered

Shuffling pairs so a shared card never neighbours another would change `imposterPairs` and its cases for every deck. Making the engine reject consecutive shared cards would break existing sessions.

## Revisit

If decks with larger hubs need a stronger spacing rule than one round.
