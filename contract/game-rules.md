# Game rules contract

This file is the executable specification of Eratic's games: the deterministic primitives, the session file, the rules engine for all nine [game modes](../docs/game-modes.md), scan resolution, and deck format version 2. The mode overview explains the product and DESIGN.md explains the interactions; this file defines exactly what both cores compute.

Both cores implement everything here as pure functions: `EraticCore` in Swift and `apps/web/src/core` in TypeScript. They take no clock, randomness, I/O or playback. Randomness enters as a seed and time as millisecond inputs. Both test suites run every case in [`cases/`](cases):

| File | What it pins |
| --- | --- |
| `game-primitives.json` | PRNG output, hashing, shuffles, draw order, anchor picks, daily selection and streaks, era lookup, every scoring function, share text, imposter pairs and the next-pair draw order |
| `game-replay.json` | Whole sessions replayed by the engine: the summary after the last action, or the index of the first rejected action |
| `session-files.json` | Session file text accepted or rejected by the strict session decoder |
| `scan-resolution.json` | Which card, if any, a scanned QR payload selects in a deck |
| `provider-tracks.json` | The provider track identity parsed from a URL or link |
| `deck-validation.json`, `qr-routes.json` | Extended for deck version 2 and the Eratic card QR route |

A rule is part of this contract only once it has a case.

## 1. Determinism

### 1.1 Integers and strings

All arithmetic below is on integers. Functions in sections 1, 3 and 8 reject inputs outside their stated domain (an invalid date, a slot outside the timeline, a card ID missing from `years`, a negative `count`, duplicate card IDs); a case pins each such rejection, and neither core returns a substitute value. "uint32" arithmetic is modulo 2^32. Card IDs, player IDs, deck IDs and member names are compared as exact strings: code point by code point, never under Unicode canonical equivalence (in Swift compare `utf8`, not `String ==` or `Set<String>`), and never through prototype-bearing lookups (in TypeScript use `Map` or `Object.hasOwn`, never `in` on a plain object; `toString` and `constructor` are valid player IDs). **Code-point order** compares two strings by their sequences of Unicode code points (equivalently, their UTF-8 bytes), never by UTF-16 units or locale collation; Swift must not use `String <`, which applies canonical equivalence. `ceil(n / 10)` is `(n + 9) / 10` in integer division; `/` on integers always floors (all operands are non-negative).

### 1.2 Hash: FNV-1a, 32 bit

```
fnv1a32(bytes):
  h = 0x811C9DC5
  for each byte b: h = (h XOR b); h = (h * 0x01000193) mod 2^32
  return h
```

Strings are hashed as their UTF-8 bytes. `deriveSeed(seed, salt) = fnv1a32(UTF-8 of decimal(seed) + ":" + salt)`, where `decimal` has no sign, padding or separators.

### 1.3 PRNG: mulberry32

The generator holds one uint32 `state`, initialised to the seed. `next()` returns a uint32:

```
state = (state + 0x6D2B79F5) mod 2^32
t = state
t = ((t XOR (t >> 15)) * (t OR 1)) mod 2^32
t = t XOR ((t + (((t XOR (t >> 7)) * (t OR 61)) mod 2^32)) mod 2^32)
return t XOR (t >> 14)
```

`>>` is a logical shift. The TypeScript reference is `a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (t ^ (t >>> 14)) >>> 0;`. A seed is any integer from 0 to 4294967295.

### 1.4 Shuffle

`shuffle(items, rng)` is Fisher–Yates from the end: copy the list; for `i` from `n − 1` down to `1`, let `j = rng.next() mod (i + 1)` and swap positions `i` and `j`. `shuffle(items, seed)` means `shuffle(items, mulberry32(seed))`.

### 1.5 Derived orders

| Function | Definition |
| --- | --- |
| `drawOrder(cardIds, seed)` | Remove duplicate IDs, sort in code-point order, then `shuffle` with `mulberry32(deriveSeed(seed, "draw"))`. The host draws the first ID of this order that is not yet used in the session. |
| `pickAnchors(cards, kind, seed, count, year?)` | Section 1.6 |
| `dailySelection(cardIds, date, deckId)` | Remove duplicates, sort in code-point order, `shuffle` with `mulberry32(fnv1a32(UTF-8 of date + deckId))` (plain concatenation, e.g. `"2026-10-11demo-deck"`), and take the first `min(5, n)` IDs. The deck file's card order never matters. |
| `imposterPairs(cards, seed)` | Section 8.3 |
| `nextImposterPair(pairs, drawn)` | `pairs` is the list from `imposterPairs` (section 8.3), in its order; `drawn` is the list of pairs already drawn in the session, in draw order, each as its two card IDs (skipped pairs included). A pair is **played** when `drawn` contains the same two IDs in either order. Returns the first pair of `pairs`, in order, that is not played and shares no card ID with the last pair of `drawn`; else the first pair that is not played; nothing when every pair is played. The apps draw this pair (Original or Imposter, section 6.9); the engine doesn't check how a pair was chosen. |
| `closerPick(candidates, referenceYear, revealed)` | Higher or Lower with `closer` (section 6.5). `candidates` is the list of unused cards `{id, year}` in `drawOrder` order. Let `W = max(3, 20 − 2 × revealed)`. Returns the first candidate whose year differs from `referenceYear` by 1 to `W` years; else the candidate with the smallest nonzero distance to `referenceYear` (the first in order on a tie); else the first candidate; nothing for an empty list. The apps draw this card instead of the first unused `drawOrder` ID. |

### 1.6 Anchor picks

`cards` is a list of `{id, year}`. `kind` is `beginning`, `middle`, `random` or `custom`; `year` is required for `custom` and ignored otherwise. Let `rng = mulberry32(deriveSeed(seed, "anchor"))` and `sorted` be the cards sorted by year ascending, then ID in code-point order. Repeat `count` times, appending each pick to `chosen`:

1. `remaining` is `sorted` without the chosen cards, in order; `n` is its length. If `n = 0`, the call fails.
2. `k = max(1, ceil(n / 10))`.
3. The pool:
   - `beginning`: the first `k` cards of `remaining`;
   - `middle`: `m = (n − 1) / 2`, `start = min(max(m − (k − 1) / 2, 0), n − k)`, and the `k` cards from `start`;
   - `random`: all of `remaining`;
   - `custom`: every card of `remaining` whose `|card.year − year|` is the minimum.
4. Pick `pool[rng.next() mod pool.length]`.

The result is the list of picked IDs in order. Personal Timeline gives the i-th pick to the i-th player in turn order.

## 2. Eras

[`eras.json`](eras.json) holds the nine eras in order with inclusive year bounds (`from` absent or `null` means open below; `to` absent or `null` means open above). It is the only source of era boundaries: scores depend on them. Colours and type moves stay in [`design/eras.json`](../design/eras.json), which lists the same IDs in the same order.

- `eraOf(year)` is the ID of the era whose bounds contain the year. Every integer year has exactly one era.
- `eraIndex(id)` is the era's position, 0 to 8. Two eras are **adjacent** when their indexes differ by 1. Shellac and Now each have one neighbour.
- Changing a boundary changes scores and invalidates recorded sessions (their card snapshots carry the era); it needs a new session version.

## 3. Scoring primitives

| Function | Result |
| --- | --- |
| `placementCorrect(years, slot, year)` | `years` is a non-decreasing list; `slot` is 0 to `len(years)`. True when `(slot = 0 or years[slot − 1] ≤ year) and (slot = len or year ≤ years[slot])`. Equal years are correct on either side. |
| `insertionIndex(years, year)` | The number of entries `≤ year`: where a card goes when it is added by year rather than by a chosen slot. |
| `distance(a, b)` | `|a − b|` |
| `bullseyePoints(guess, answer)` | By distance: 0 → 10, 1 → 7, 2–3 → 5, 4–5 → 3, 6–10 → 1, more → 0 |
| `eraSortPoints(guessEra, answerYear, kids)` | 3 if `guessEra = eraOf(answerYear)`; if adjacent, 3 when `kids`, else 1; otherwise 0 |
| `ladderPoints(stepIndex, titleOK, artistOK)` | `P = [10, 8, 6, 4, 2][stepIndex]`; both right → P, one right → `P / 2` (floored), neither → 0 |
| `ladderYearPoints(guess, answer)` | Year mode: exact 5; distance ≤ 2 → 3; same era → 1; otherwise 0 |
| `ladderYearBonus(guess, answer)` | Both mode: exact 3; distance ≤ 2 → 1; otherwise 0 |
| `higherLowerCorrect(refYear, year, call)` | `earlier`: `year ≤ refYear`; `later`: `year ≥ refYear` |
| `lineupPoints(order, years)` | `order` is a list of card IDs, `years` maps each to its year. One point for every pair `i < j` with `years[order[i]] ≤ years[order[j]]`; plus 2 if every pair scored. K = 4 has 6 pairs (perfect 8), K = 5 has 10 (perfect 12). |
| `imposterPoints(pickedOriginal, yearGuess?, originalYear)` | 5 if the original was picked, plus 3 if a year was guessed and `distance ≤ 2` |
| `nameItAward(titleOK, artistOK)` | True only when both are right |

## 4. Session file (`session-v2`, `session-v1`)

[`session-v2.schema.json`](session-v2.schema.json) is the structure of `sessionVersion` 2, which apps create and write. [`session-v1.schema.json`](session-v1.schema.json) is the unchanged structure of `sessionVersion` 1: such files are still read, replayed under the version 1 rules and exported unchanged as version 1, never rewritten. The two differ in the Snippet Ladder `steps` limit and default (section 6.4), and version 2 adds the options Snippet Ladder `buzzer` and Higher or Lower `play`, `lives` and `closer` (sections 6.4 and 6.5), which version 1 rejects even with their default values. A writer omits `play` when it is `turns` and `closer` and `buzzer` when they are false, so a game that doesn't use them stays readable by apps that predate them; with `play: everyone` it always writes `lives`. Any other `sessionVersion` is rejected. A session file is strict JSON exactly like a deck file: RFC 8259 text in UTF-8 (a leading BOM is ignored), no duplicate member names, no `null` anywhere, no unknown members, every string well-formed Unicode, at most 2 MiB. A session is valid only when it matches the schema **and** the engine replays every action without error (section 5). Sessions are never written into deck files.

```json
{
  "format": "eratic-session",
  "sessionVersion": 2,
  "id": "s-20261011-1",
  "createdAt": "2026-10-11T19:30:00Z",
  "deckId": "demo-deck",
  "deckTitle": "Demo deck",
  "mode": "bullseye",
  "options": { "rounds": 10 },
  "seed": 42,
  "players": [{ "id": "p1", "name": "Ada" }, { "id": "p2", "name": "Lin" }],
  "actions": [{ "type": "draw", "at": 0, "card": { "cardId": "c1", "year": 1984, "era": "neon" } }]
}
```

| Member | Rule |
| --- | --- |
| `id`, `deckId` | The deck ID pattern `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` |
| `createdAt` | `YYYY-MM-DDTHH:MM:SSZ` (pattern only) |
| `deckTitle` | Visible text as in decks, 1–500 code points |
| `mode` | One of `ladder`, `timeline`, `bullseye`, `eraSort`, `higherLower`, `relay`, `lineup`, `daily`, `imposter` |
| `options` | An object; the allowed members per mode are in section 6. Absent members take their defaults. |
| `seed` | Integer 0–4294967295 |
| `players` | 1–10 objects `{id, name, members?}`. `id` matches `^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$` and is unique. `name` is visible text of 1–40 code points. `members` (a team's display names) is a list of 0–8 such names. The mode's player-count range is checked by the engine. |
| `actions` | 0–10000 action objects (section 5) |

Player names are personal data. They stay on the device; nothing sends them anywhere. Scores are derived by replaying, never stored.

## 5. Engine

### 5.1 Card references and the action envelope

A **card reference** is `{cardId, year, era}`: the card's ID, its curated `gameYear.value` (1850–2100) at the time it was drawn, and `era`, which must equal `eraOf(year)`. It is a snapshot, so later deck edits never rewrite a session.

Every action is an object with `type` and `at`. `at` is milliseconds since the session started: an integer ≥ 0 and ≥ the previous action's `at`. A `playerId` must name a session player. A rejected action rejects the whole session; replay reports its index (0-based). Invalid setup (options or player count) is reported as index −1.

A card ID can enter a session at most once, through any of `anchor`, `reference`, `draw`, `drawSet` or `sdDraw`. Imposter mode is the exception: a card may appear in several pairs, but the same two cards may not be paired twice.

### 5.2 Phases

| Phase | Meaning |
| --- | --- |
| `setup` | Waiting for anchors (Timeline, Relay) or the reference card (Higher or Lower) |
| `awaitingDraw` | Waiting for the next card |
| `open` | A card (or set or pair) is in play and not yet revealed |
| `suddenDeath` | The game tied for first place; waiting for a sudden-death draw |
| `suddenDeathOpen` | A sudden-death card is in play |
| `finished` | Nothing more is accepted |

The game starts in `setup` for Timeline, Relay and Higher or Lower and in `awaitingDraw` otherwise.

### 5.3 Actions every mode accepts

| Action | Allowed in | Effect |
| --- | --- | --- |
| `clip {fromMs, lengthMs?}` | `open`, `suddenDeathOpen` | A record of playback (integers, `fromMs ≥ 0`, `lengthMs ≥ 1`). No effect on scores. |
| `skip` | `open`, `suddenDeathOpen` | The card in play is discarded unscored (unavailable track, network failure). Every input given for it (guesses, locks, placements, wagers, challenges with their tokens, marks) is undone. The phase returns to `awaitingDraw` or `suddenDeath`; the turn does not advance and no round is counted. |
| `end` | any but `finished` | The host ends the game. A card in play is discarded as by `skip`. In `suddenDeath` or `suddenDeathOpen` the game finishes with the tie standing. Before the first reveal (round 0) it finishes without sudden death. Otherwise the end evaluation of section 5.5 runs, which may enter sudden death. |

### 5.4 Wagers (the Stakes modifier)

With `stakes: true` (Ladder, Timeline, Bullseye), every player starts with 5 chips. `wager {playerId, chips}` is allowed in `open`, once per player per card, before the reveal:

- In Timeline the wager comes after `place` (section 6.3); elsewhere any time the card is open.
- A player holding 0 chips can't wager; the action is rejected.
- Otherwise `chips` is 1 to `min(3, held)`.
- The reveal requires a wager from every player who must wager and holds at least 1 chip: all players in Ladder and Bullseye, only the active player in Timeline. Nobody else may wager.
- At the reveal a right player gains the wager and a wrong one loses it. "Right" means: Ladder, scoring more than 0 on the card; Bullseye, distance ≤ 3; Timeline, the active player's placement is correct.
- With stakes on, a player's score is their points plus the chips they hold.

### 5.5 Ranking, end evaluation and sudden death

Each mode lists ranking keys (section 6). `standings` is the list of player groups ordered by those keys; players with equal keys share a group, and each group lists its players in turn order. Standings are computed at every point of the game.

**End evaluation** runs when a mode's end condition is met or on `end`. If the mode has a sudden-death kind and the first group has more than one player, the phase becomes `suddenDeath` with those players; otherwise `finished`.

**Sudden death** is played only by the tied leaders:

1. `sdDraw {cards}` in `suddenDeath`: 1 card for `closestYear` and `firstToName`, K cards for `lineup` (4 for Timeline, the game's `k` for Lineup). The phase becomes `suddenDeathOpen`.
2. Inputs, once per sudden-death player:
   - `closestYear`: `sdGuess {playerId, year}`, year 1850–2100;
   - `lineup`: `sdOrder {playerId, order}`, a permutation of the drawn card IDs;
   - `firstToName`: one `sdName {playerId?}` naming the first sudden-death player who named the song, or no `playerId` if nobody did.
3. `reveal` needs every input. The best players continue: smallest distance, highest `lineupPoints`, or the named player. If one player is best, they win and the game finishes; if nobody named the song, everyone continues. The others are eliminated in this sudden-death round. If more than one is best, the phase returns to `suddenDeath` with them.

Final standings after a sudden death: the winner, then the players eliminated in sudden death, latest round first (one group per round), then the remaining groups of the main standings. If the host ends during sudden death, the still-tied players form the first group.

### 5.6 Turns

Modes with an active player (Timeline, Relay, and Higher or Lower with `play: turns`) start with the first player in `players` order. The turn passes to the next player after each reveal, wrapping around; Higher or Lower versus skips eliminated players.

## 6. Modes

Each mode lists its options (name, allowed values, default), player-count range, actions, end condition, ranking keys and sudden-death kind. Options outside their range, unknown option names and player counts outside the range are setup errors.

### 6.1 Bullseye (`bullseye`)

- **Options:** `rounds` 1–100 (10); `stakes` boolean (false).
- **Players:** 1–10.
- **Round:** `draw {card}` → each player `guess {playerId, year}` once (1850–2100) → wagers if stakes → `reveal`, which needs every guess. Points: `bullseyePoints`.
- **End:** after `rounds` reveals.
- **Ranking:** score ↓, exact hits ↓, total distance ↑. **Sudden death:** `closestYear`.
- **Summary extras:** `exact`, `distance` (per player), `chips` when stakes.

### 6.2 Era Sort (`eraSort`)

- **Options:** `rounds` 1–100 (10); `kids` boolean (false).
- **Players:** 1–10.
- **Round:** `draw {card}` → each player `pickEra {playerId, era}` once (an era ID) → `reveal`, which needs every pick. Points: `eraSortPoints(era, card.year, kids)`. A pick scoring 3 counts as a **right era**.
- **End:** after `rounds` reveals.
- **Ranking:** score ↓, right eras ↓. **Sudden death:** `closestYear`.
- **Summary extras:** `rightEras`.

### 6.3 Timeline (`timeline`)

- **Options:** `ownership` `personal` | `shared` (`personal`); `anchor` `beginning` | `middle` | `random` | `custom` (`random`); `anchorYear` 1850–2100 (required when `anchor` is `custom`, forbidden otherwise); `target` 2–30 (10); `challenges` boolean (true); `tokens` 0–5 (2); `nameIt` boolean (false); `stakes` boolean (false); `clip` `full` | `30s` | `10s` (`full`, informational).
- **Players:** 2–8.
- **Setup:** personal: one `anchor {playerId, card}` per player, in turn order; shared: one `anchor {card}` without `playerId`. The anchor opens the timeline. The engine doesn't check how the anchor was chosen; `pickAnchors` is what the apps use.
- **Turn** of the active player:
  1. `draw {card}`.
  2. `place {playerId, slot}` by the active player, once: slot 0 to the length of the active player's timeline (personal) or the shared timeline.
  3. Optional, after `place`:
     - `challenge {playerId, slot}`, only with `challenges` on: by another player holding at least 1 token, once per turn, with a slot in the same range that differs from the placement and from every earlier challenge this turn. The token is spent at once.
     - `nameIt {playerId, titleOK, artistOK}`, only with `nameIt` on, by the active player, once.
     - `wager`, if stakes.
  4. `reveal`. If the placement is correct (`placementCorrect` on the timeline's years), the card goes into that timeline at the slot. Otherwise the first challenger in action order whose slot is correct takes it: personal, into the challenger's own timeline at `insertionIndex`; shared, into the shared timeline at the challenger's slot. If nobody is right, the card is discarded, and the active player's **wrong placements** count rises by 1. If `nameItAward`, the active player gains a token, up to 5.
- **Points:** personal, the number of cards in the player's timeline (anchor included); shared, the number of cards the player added to the shared timeline by placement or challenge (the anchor belongs to nobody).
- **End:** after a reveal, if any personal timeline (or the shared timeline) has at least `target` cards, the game ends once the round is complete: at the reveal of the last player in turn order. This may be the same reveal.
- **Ranking:** score ↓, wrong placements ↑. **Sudden death:** `lineup` with 4 cards.
- **Summary extras:** `timelines` (personal: player → card IDs in order) or `timeline` (shared: card IDs), `tokens`, `wrong`, `chips` when stakes.

### 6.4 Snippet Ladder (`ladder`)

- **Options:** `rounds` 1–100 (10); `steps`, 1–5 strictly increasing integers from 500 to 30000 (`[1000, 5000, 10000, 20000, 30000]`), where step *i* scores with `ladderPoints(i, …)`; `guess` `name` | `year` | `both` (`name`); `clipStart` `card` | `skipIntro` | `zero` (`card`, informational); `stakes` boolean (false); `buzzer` boolean (false), session version 2 only. A preview-only account drops the steps longer than its preview before the session starts. Version 1 sessions keep steps up to 600000 and the default `[1000, 5000, 10000, 30000, 60000]`, also when `steps` is omitted.
- **Players:** 1–8.
- **Card:**
  1. `draw {card}`; the current step is −1, nothing played yet.
  2. `step {index}` plays a step: `index` is the current step (a replay after a stall, allowed once a step has played) or the next one, at most the last.
  3. `lock {playerId, year?}` once per player, after the first step: the lock records the current step. `year` (1850–2100) is required in `year` and `both` modes and forbidden in `name` mode.
  4. In `name` and `both` modes, `mark {playerId, titleOK, artistOK}` once for each locked player. Marks may follow any lock; unlocked players are never marked.
  5. Wagers, if stakes.
  6. `reveal`, which needs a step played and either every player locked or the last step played, plus a mark for every locked player (`name`, `both`).
- **Points per card:** unlocked players 0. `name`: `ladderPoints(lockStep, titleOK, artistOK)`. `year`: `ladderYearPoints`. `both`: `ladderPoints` plus `ladderYearBonus`. An exact year counts as an **exact year** (`year`, `both`). With `buzzer`, the player whose `lock` came first in action order among those scoring more than 0 on the card gains 2 more points (a **buzzer**); wagers are settled on the points before the bonus, which never changes whether a player was right.
- **Time used:** each card adds `steps[lockStep]` for a locked player and `steps[last]` for an unlocked one.
- **End:** after `rounds` reveals.
- **Ranking:** score ↓, time used ↑, exact years ↓. **Sudden death:** `firstToName` (one card, one 5 s step in the apps).
- **Summary extras:** `usedMs`, `exactYears`, `step` (current step index, −1 outside a card), `chips` when stakes, `buzzers` (player → count) when `buzzer`.

### 6.5 Higher or Lower (`higherLower`)

- **Options:** `cards` 2–100 (10), the number of reveals after which versus play ends; solo ignores it. `play` `turns` | `everyone` (`turns`). `lives` 1–5 (3), allowed only with `play: everyone`. `closer` boolean (false): the apps draw with `closerPick` (section 1.5) so the songs get closer in year as the game goes on; the engine doesn't check how a card was drawn. `play`, `lives` and `closer` exist only in session version 2; a version 1 session with any of them is a setup error.
- **Players:** 1–6. One player is solo; more is versus.
- **Setup:** `reference {card}`, face up.
- **Turns** (`play: turns`): `draw {card}` → `call {playerId, call}` by the active player, `earlier` or `later` → `reveal`. Correct (`higherLowerCorrect`) adds 1 to the player's streak. A miss ends a solo game (the solo player is not listed in `eliminated`), or eliminates a versus player. The drawn card becomes the reference either way.
- **Everyone** (`play: everyone`): there is no active player. Every player starts with `lives`. `draw {card}` → one `call {playerId, call}` from each player still in, in any order → `reveal`, which needs every such call. For each caller in turn order: correct adds 1 to their streak; a miss costs a life, and a player left with 0 lives is out: a versus player is appended to `eliminated` (players out in the same reveal in turn order); a solo player ends the game and is not listed. The drawn card becomes the reference. A streak counts correct calls; a miss does not reset it.
- **Score:** the player's streak.
- **End:** solo, on the first miss (`turns`) or when the solo player has no lives left (`everyone`); versus, when at most one player is still in, or after `cards` reveals.
- **Ranking:** players still in ahead of eliminated ones; then streak ↓, then (with `everyone`) lives ↓; eliminated players by the reveal that eliminated them, later first, then streak ↓. Players with equal keys share a group. (With `everyone`, players still in after the same reveals always have equal lives when their streaks are equal, and players out in the same reveal have equal streaks; the keys are listed for completeness.) No sudden death.
- **Summary extras:** `streaks`, `eliminated` (player IDs in elimination order), `reference` (card ID), `lives` (player → lives, with `everyone` only). With `everyone`, `active` is absent.

### 6.6 Relay (`relay`)

- **Options:** `target` 2–30 (12); `lives` 1–10 (3); `anchor` and `anchorYear` as Timeline (`random`); `nameIt` boolean (false).
- **Players:** 2–10, all on one team. The active player is the turn's **voice**.
- **Setup:** one `anchor {card}`.
- **Turn:** `draw {card}` → `place {playerId, slot}` by the voice → `nameIt {playerId, titleOK, artistOK}` by the voice if on → `reveal`. Name It is judged before the reveal, so it applies first: with `nameItAward`, lives rise by 1, up to `lives`. Then a correct placement adds the card at the slot; a wrong one costs a life and discards the card.
- **End:** the team loses when lives reach 0, and wins when the line has `target` cards (anchor included). Lives are checked first, but a correct placement never costs a life, so one reveal can't do both.
- **Team score:** `lives × 10 + line length`, at every point.
- **Ranking:** none; `scores` is empty and `standings` is `[]`. No sudden death.
- **Summary extras:** `lives`, `timeline`, `teamScore`, `outcome` (`playing`, `won`, `lost`, or `ended` after `end`).

### 6.7 Lineup (`lineup`)

- **Options:** `k` 3–5 (4); `rounds` 1–20 (5); `clipMs` 1000–60000 (10000, informational).
- **Players:** 1–6.
- **Lineup:** `drawSet {cards}` with exactly `k` cards → each player `order {playerId, order}` once, a permutation of the set's card IDs → `reveal`. Points: `lineupPoints`. A line scoring every pair is **perfect**.
- **End:** after `rounds` reveals.
- **Ranking:** score ↓, perfect lines ↓. **Sudden death:** `lineup` with `k` cards.
- **Summary extras:** `perfect`.

### 6.8 Daily Eratic (`daily`)

- **Options:** `date`, a real calendar date `YYYY-MM-DD`, required; `cards`, the day's `dailySelection` (1–5 unique card IDs), required. No defaults.
- **Players:** exactly 1.
- **Round i** (from 1): `draw {card}` whose `cardId` is `cards[i − 1]`. Rounds 1–3 are Era Sort (`pickEra`, without Kids); later rounds are Bullseye (`guess`). Then `reveal`.
- **End:** after every selected card is revealed. A skipped card stays used, and round *i* can only draw `cards[i − 1]`, so after a `skip` the host can only `end`.
- **Maximum:** `3 × min(3, n) + 10 × max(0, n − 3)` for `n` selected cards; 29 for five.
- **Share text** (when finished): `Eratic <date> · <score>/<maximum> · <era names>`, with the revealed cards' era names (from `eras.json`) separated by single spaces, in round order. The separators are U+00B7 with one space on each side. No emoji, titles or artists.
- **Streak:** `dailyStreak(previous, date)` with `previous` absent or `{lastDate, streak}`: absent → 1; `lastDate = date` → `streak` unchanged; `lastDate` is the day before `date` → `streak + 1`; otherwise 1. Dates are proleptic Gregorian with four-digit years; `date` and `lastDate` must both be valid, or the call fails. `0000-01-01` has no day before it, so it is never consecutive.
- **Ranking:** score. No sudden death.
- **Summary extras:** `maxScore`, `eras` (revealed era IDs), `shareText` when finished.

### 6.9 Original or Imposter (`imposter`)

- **Options:** `rounds` 1–50 (5).
- **Players:** 2–8.
- **Pair:** `drawPair {a, b, original}`, two card references with different IDs and `original` `a` or `b`; the same two cards can't be paired twice, in either order, and a skipped pair stays used. Each player `choose {playerId, pick, year?}` once, `pick` `a` or `b`, `year` 1850–2100 → `reveal`. Points: `imposterPoints`. A year within 2 of the original's counts as a **bonus**. The apps choose each pair with `nextImposterPair` (section 1.5), so a card shared by several pairs doesn't play in consecutive rounds when another pair is left.
- **End:** after `rounds` reveals.
- **Ranking:** score ↓, bonuses ↓. No sudden death.
- **Summary extras:** `bonuses`.

## 7. Summary

`summarize(state)` returns a JSON object. Cases compare only the members they list.

| Member | Value |
| --- | --- |
| `phase` | Section 5.2 |
| `round` | Reveals counted so far (not sudden-death reveals) |
| `scores` | Player ID → score (with stakes, including chips) |
| `standings` | List of groups of player IDs (section 5.5) |
| `active` | The active player's ID, in modes that have one and while not finished (also during sudden death, where turns don't advance) |
| `suddenDeath` | `{kind, players}` during `suddenDeath` and `suddenDeathOpen` |
| Mode extras | As listed per mode |

## 8. Scanning, provider tracks and deck version 2

### 8.1 Provider tracks

`providerTrack(text)` returns `{provider, id}` (plus `storefront` for Apple Music when the URL has one) or nothing:

- **Spotify:** `spotify:track:<id>`, or a safe HTTPS URL whose host is `open.spotify.com` (any case) and whose path is `/track/<id>` or `/intl-<tag>/track/<id>` (`<tag>` is letters and hyphens). `<id>` is exactly 22 characters of `[0-9A-Za-z]`. A query or fragment is ignored.
- **Apple Music:** a safe HTTPS URL whose host is `music.apple.com` (any case) and whose path starts with `/<storefront>/` (two ASCII letters, returned lowercased):
  - `/<sf>/album/<slug>/<album id>` with a query parameter `i=<digits>`: the song ID is the `i` value;
  - `/<sf>/song/<slug>/<digits>` or `/<sf>/song/<digits>`: the song ID is the digits.
  IDs are 1–15 ASCII digits. Query parameters are split on `&`; the first `i` parameter is used.

`linkTrack(link)` uses `link.id` when it has the provider's ID shape (22 base62 characters for `spotify`, 1–15 digits for `appleMusic`), otherwise `providerTrack(link.url)` if that returns the link's own provider; other providers have no track identity.

### 8.2 Eratic card QR route

The Eratic card URL identifies a deck and card, not a provider: `https://<host>/c/<deckId>/<cardId>`, where both IDs match the deck ID pattern (so no escaping is ever needed). `<host>` is configured per app build; until the domain is chosen (see docs/STATUS.md) no build configures one, so no app produces this route. A configured host is valid when `https://<host>/` is a safe HTTPS URL and the host contains none of `:`, `/`, `?` or `#`.

- `qrPayload(card, "eraticCard", {host, deckId})` and `eraticCardURL(host, deckId, cardId)` return the URL, or nothing when the host is invalid or either ID doesn't match the deck ID pattern.
- `resolveScan(payload, deck, hosts)` returns the first that applies:
  1. `payload` is a safe HTTPS URL, its host (any case) equals one of `hosts` (compared lowercased), and the rest is exactly `/c/<deckId>/<cardId>` with no query or fragment: `{kind: "card", cardId, via: "eraticCard"}` when the deck ID matches and the card exists; `{kind: "unknownCard", cardId}` when the deck matches but the card doesn't; `{kind: "otherDeck", deckId}` otherwise.
  2. Some card has a link whose `url` equals `payload` exactly: the first such card in deck order, `{kind: "card", cardId, via: "providerLink"}`.
  3. `providerTrack(payload)` returns a track and some card has a link whose `linkTrack` has the same provider and ID: the first such card, `via: "providerLink"`. If no card matches: `{kind: "unmatchedProvider", provider, trackId}`.
  4. Some card's `officialCard.url` equals `payload` exactly: the first such card, `via: "officialCard"`. Official URLs are never resolved through any outside catalogue. If none matches but `isOfficialCardURL(payload)`: `{kind: "unmatchedOfficial"}`.
  5. Otherwise `{kind: "unrecognized"}`.

A scan only selects a card. It never opens a provider app, so audio stays under the host's control.

### 8.3 Deck version 2

[`deck-v2.schema.json`](deck-v2.schema.json) is version 1 with `schemaVersion: 2` and these optional members; every version-1 rule still applies:

| Member | Rule | Used by |
| --- | --- | --- |
| `deck.defaultClipStartMs` | Integer 0–3600000 | Ladder, Lineup |
| `card.clip` | `{startMs}`, integer 0–3600000, no other members | Ladder, Lineup |
| `card.relatedTo` | `{cardId, relation}`; `relation` is `originalOf`, `coverOf` or `remasterOf`; `cardId` must name another card in the same deck | Original or Imposter |
| `card.difficulty` | Integer 1–5 | Kids ("easy cards only": difficulty 1–2) |

A version-1 deck containing any of these members is rejected, as before. `migrateDeck(v1)` returns the same deck with `schemaVersion: 2` and nothing else changed, validated as version 2. Export keeps the deck's own version; the apps migrate a deck to version 2 only when the user sets a version-2 field. Both versions share the browser storage slot; an older app keeps a version-2 deck aside as unreadable rather than overwriting it.

**Clip start** for a card: `card.clip.startMs`, else `deck.defaultClipStartMs`, else the session's choice (0, or 15000 for "skip intro").

**Imposter pairs.** A card is **derived** when its `relatedTo.relation` is `coverOf` or `remasterOf`. `imposterPairs(cards, seed)`:

1. For each derived card X whose target T exists and is not derived: the pair (original T, other X).
2. For each non-derived card O with `relation: originalOf` whose target X exists: the pair (original O, other X).
3. Remove duplicate pairs; sort by original ID, then other ID, in code-point order.
4. `rng = mulberry32(deriveSeed(seed, "pairs"))`; shuffle the pairs with `rng`; then, for each pair in order, `rng.next() mod 2 = 0` means the original plays as `a`, otherwise as `b`.

The result is a list of `{a, b, original}` card IDs. A chain A ← B ← C (B covers A, C covers B) yields only (A, B): C's target B is derived.

**Linked-recording suggestions.** `suggestRelations(cards)` proposes `relatedTo` links for the host to review; nothing is linked without the host's confirmation, and a suggestion is never a curated fact. `songKey(text)` normalizes a title or artist:

1. Lowercase each code point on its own with its Unicode lowercase mapping, without context (so `Σ` always becomes `σ`), then decompose (NFD) and remove every combining mark (general category M).
2. Repeat until nothing changes. Remove trailing U+0020 spaces. A part **names a version** when one of its maximal runs of ASCII letters `a`–`z` is one of `remaster`, `remastered`, `live`, `version`, `edit`, `mix`, `remix`, `mono`, `stereo`, `demo`, `acoustic`, `single`, `radio`, `feat`, `ft`. Then:
   - if the text ends with `)` or `]` and contains a matching `(` or `[` before it, the **group** runs from the last such opener to the end; if the group names a version, remove it and repeat;
   - otherwise, or when the group names no version: if the text contains ` - ` (space, hyphen-minus, space), the **dash part** is everything after its last occurrence; if the dash part names a version, remove from that occurrence to the end and repeat;
   - otherwise stop.
3. Replace every run of characters that are not letters or digits (general categories L and N) with one space, and trim spaces.

Then:

1. Group all cards with a non-empty `songKey(title)` by that key; groups of one card are dropped. A card that already has `relatedTo` can be a group's original but is never suggested itself.
2. In each group the **original** is the card with the smallest `gameYear.value`, then the smallest ID in code-point order.
3. Every other card X in the group without `relatedTo` gets `{cardId: X, relatedTo: original, relation}`: `remasterOf` when `songKey(X.artist)` equals `songKey(original.artist)`, otherwise `coverOf`.
4. Sort by original ID, then card ID, in code-point order.
