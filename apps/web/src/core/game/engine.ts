import { distance, lineupPoints } from "../scoring";
import {
  normalizeOptions,
  type CardRef,
  type GameAction,
  type GameMode,
  type Session,
  type SessionOptions,
  type SessionPlayer,
} from "../session";
import { bullseye } from "./bullseye";
import {
  activeId,
  checkCards,
  checkYear,
  fail,
  GameError,
  has,
  isPermutation,
  once,
  perPlayer,
  requirePhase,
  takeCard,
  type GameState,
  type ModeRules,
  type SuddenDeath,
} from "./common";
import { daily } from "./daily";
import { eraSort } from "./eraSort";
import { higherLower } from "./higherLower";
import { imposter } from "./imposter";
import { ladder } from "./ladder";
import { lineup } from "./lineup";
import { relay, relayLine } from "./relay";
import { timeline, timelineCards } from "./timeline";

// The rules engine of contract/game-rules.md sections 5-7: pure functions over
// plain data. Randomness and time enter only through the session's actions.
export { GameError };
export type { GameState, Phase, SuddenDeathKind } from "./common";

const MODES: Record<GameMode, ModeRules> = {
  bullseye,
  eraSort,
  timeline,
  ladder,
  higherLower,
  relay,
  lineup,
  daily,
  imposter,
};
const rulesOf = (state: GameState): ModeRules => MODES[state.mode];
const stakes = (state: GameState): boolean => state.chips !== undefined;

export interface GameSetup {
  mode: GameMode;
  options: SessionOptions;
  players: SessionPlayer[];
  seed: number;
}
const PLAYER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/u;
// Visible text of 1 to 40 code points, as the session schema requires.
const isName = (value: unknown): boolean =>
  typeof value === "string" && [...value].length >= 1 && [...value].length <= 40 && /\S/u.test(value);
function checkPlayers(players: unknown): void {
  if (!Array.isArray(players)) fail("players must be a list.");
  for (const player of players as SessionPlayer[]) {
    if (typeof player !== "object" || player === null) fail("A player is an object.");
    if (typeof player.id !== "string" || !PLAYER_ID.test(player.id))
      fail(`Invalid player ID: ${String(player.id)}.`);
    if (!isName(player.name)) fail(`Invalid name for player ${player.id}.`);
    if (
      player.members !== undefined &&
      (!Array.isArray(player.members) || player.members.length > 8 || !player.members.every(isName))
    )
      fail(`Invalid members for player ${player.id}.`);
  }
}

// Setup errors (options, player count, players, seed) are reported as action index -1.
// The engine checks everything itself, so in-memory callers get the same answers as file import.
export function startGame(setup: GameSetup): GameState {
  if (!has(MODES, setup.mode)) throw new GameError(`Unknown mode: ${String(setup.mode)}.`, -1);
  const rules = MODES[setup.mode];
  if (!Number.isInteger(setup.seed) || setup.seed < 0 || setup.seed > 0xffffffff)
    throw new GameError("seed must be an integer from 0 to 4294967295.", -1);
  checkPlayers(setup.players);
  let options;
  try {
    options = normalizeOptions(setup.mode, setup.options);
  } catch (error) {
    throw new GameError((error as Error).message, -1);
  }
  const [min, max] = rules.players;
  if (setup.players.length < min || setup.players.length > max)
    throw new GameError(`${setup.mode} needs ${min} to ${max} players.`, -1);
  if (new Set(setup.players.map((player) => player.id)).size !== setup.players.length)
    throw new GameError("Player IDs must be unique.", -1);
  const state: GameState = {
    mode: setup.mode,
    options,
    players: structuredClone(setup.players),
    seed: setup.seed,
    phase: rules.start,
    round: 0,
    lastAt: 0,
    used: [],
    turn: 0,
    points: {},
    wagers: {},
    m: undefined,
  };
  state.points = perPlayer(state, 0);
  if ((options as { stakes?: boolean }).stakes) state.chips = perPlayer(state, 5);
  state.m = rules.init(state);
  return state;
}

// Returns the state after the action; the caller's state is never changed.
export function applyAction(
  state: GameState,
  action: GameAction,
  index: number,
): GameState {
  const next = structuredClone(state);
  try {
    step(next, action);
  } catch (error) {
    if (error instanceof GameError) throw new GameError(error.message, index);
    throw error;
  }
  return next;
}
export function replay(session: Pick<Session, keyof GameSetup | "actions">): GameState {
  let state = startGame(session);
  session.actions.forEach((action, index) => {
    state = applyAction(state, action, index);
  });
  return state;
}

function step(state: GameState, action: GameAction): void {
  if (state.phase === "finished") fail("The game is finished.");
  if (typeof action !== "object" || action === null) fail("An action is an object.");
  if (!Number.isInteger(action.at) || action.at < state.lastAt)
    fail("at must not decrease.");
  state.lastAt = action.at;
  const playerId = has(action, "playerId")
    ? (action as { playerId?: unknown }).playerId
    : undefined;
  if (playerId !== undefined && !state.players.some((player) => player.id === playerId))
    fail(`Unknown player: ${String(playerId)}.`);
  switch (action.type) {
    case "clip":
      requirePhase(state, "open", "suddenDeathOpen");
      if (
        !Number.isInteger(action.fromMs) ||
        action.fromMs < 0 ||
        (action.lengthMs !== undefined &&
          (!Number.isInteger(action.lengthMs) || action.lengthMs < 1))
      )
        fail("A clip needs fromMs >= 0 and lengthMs >= 1.");
      return;
    case "skip":
      requirePhase(state, "open", "suddenDeathOpen");
      return discard(state);
    case "end":
      return end(state);
    case "reveal":
      if (state.phase === "open") return reveal(state);
      requirePhase(state, "suddenDeathOpen");
      return suddenDeathReveal(state);
    case "wager":
      return wager(state, action.playerId, action.chips);
    case "sdDraw":
    case "sdGuess":
    case "sdOrder":
    case "sdName":
      return suddenDeathInput(state, action);
  }
  rulesOf(state).act(state, action);
}

// skip (section 5.3): the card is discarded unscored; the turn does not advance.
function discard(state: GameState): void {
  if (state.phase === "suddenDeathOpen") {
    clearSuddenDeathCard(state.sd!);
    state.phase = "suddenDeath";
    return;
  }
  rulesOf(state).discard(state);
  state.card = undefined;
  state.wagers = {};
  state.phase = "awaitingDraw";
}
function end(state: GameState): void {
  if (state.phase === "suddenDeath" || state.phase === "suddenDeathOpen") {
    // The tie stands.
    if (state.phase === "suddenDeathOpen") clearSuddenDeathCard(state.sd!);
    state.phase = "finished";
    return;
  }
  if (state.phase === "open") discard(state);
  rulesOf(state).onEnd?.(state);
  // Before the first reveal the game finishes without sudden death.
  if (state.round === 0) state.phase = "finished";
  else evaluateEnd(state);
}

// Wagers (section 5.4).
function wager(state: GameState, playerId: string, chips: number): void {
  requirePhase(state, "open");
  const rules = rulesOf(state);
  if (!stakes(state)) fail("Wagers need Stakes.");
  if (!rules.wagerers!(state).includes(playerId)) fail(`${playerId} doesn't wager.`);
  if (rules.canWager && !rules.canWager(state, playerId)) fail("Not yet.");
  once(state.wagers, playerId);
  const held = state.chips![playerId];
  if (held === 0) fail(`${playerId} holds no chips.`);
  if (!Number.isInteger(chips) || chips < 1 || chips > Math.min(3, held))
    fail(`A wager is 1 to ${Math.min(3, held)} chips.`);
  state.wagers[playerId] = chips;
}
const missingWagers = (state: GameState): string[] =>
  stakes(state)
    ? rulesOf(state)
        .wagerers!(state)
        .filter((id) => state.chips![id] >= 1 && !has(state.wagers, id))
    : [];

function reveal(state: GameState): void {
  const rules = rulesOf(state);
  if (!rules.canReveal(state) || missingWagers(state).length > 0)
    fail("The reveal needs every input.");
  const right = Object.fromEntries(
    Object.keys(state.wagers).map((id) => [id, rules.right!(state, id)]),
  );
  rules.reveal(state);
  for (const [id, chips] of Object.entries(state.wagers))
    state.chips![id] += right[id] ? chips : -chips;
  state.round++;
  state.card = undefined;
  state.wagers = {};
  state.phase = "awaitingDraw";
  if (rules.ended(state)) evaluateEnd(state);
}

// Ranking, end evaluation and sudden death (section 5.5).
function scoreOf(state: GameState, id: string): number {
  const rules = rulesOf(state);
  const points = rules.score ? rules.score(state, id) : state.points[id];
  return points + (state.chips?.[id] ?? 0);
}
function mainStandings(state: GameState): string[][] {
  const rank = rulesOf(state).rank;
  if (!rank) return [];
  const keyed = state.players.map((player, index) => ({
    id: player.id,
    index,
    keys: rank(state, player.id, scoreOf(state, player.id)),
  }));
  const compare = (a: number[], b: number[]): number => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
  };
  keyed.sort((a, b) => compare(a.keys, b.keys) || a.index - b.index);
  const groups: string[][] = [];
  keyed.forEach((entry, i) => {
    if (i > 0 && compare(keyed[i - 1].keys, entry.keys) === 0)
      groups[groups.length - 1].push(entry.id);
    else groups.push([entry.id]);
  });
  return groups;
}
export function standings(state: GameState): string[][] {
  const sd = state.sd;
  if (!sd) return mainStandings(state);
  return [
    sd.winner ? [sd.winner] : sd.players,
    ...[...sd.eliminated].reverse(),
    ...sd.rest,
  ];
}
function evaluateEnd(state: GameState): void {
  const kind = rulesOf(state).suddenDeath?.kind;
  const groups = mainStandings(state);
  if (kind && groups.length > 0 && groups[0].length > 1) {
    state.sd = {
      kind,
      players: groups[0],
      eliminated: [],
      rest: groups.slice(1),
      cards: [],
      guesses: {},
      orders: {},
      named: false,
    };
    state.phase = "suddenDeath";
  } else state.phase = "finished";
}
function clearSuddenDeathCard(sd: SuddenDeath): void {
  sd.cards = [];
  sd.guesses = {};
  sd.orders = {};
  sd.named = false;
  sd.namedPlayer = undefined;
}
function suddenDeathInput(
  state: GameState,
  action: Extract<GameAction, { type: "sdDraw" | "sdGuess" | "sdOrder" | "sdName" }>,
): void {
  const sd = state.sd;
  const kind = { sdDraw: undefined, sdGuess: "closestYear", sdOrder: "lineup", sdName: "firstToName" }[
    action.type
  ];
  if (!sd || (kind && sd.kind !== kind)) fail(`${action.type} is not part of this game.`);
  if (action.type === "sdDraw") {
    requirePhase(state, "suddenDeath");
    const count = rulesOf(state).suddenDeath!.count(state);
    checkCards(action.cards);
    if (action.cards.length !== count) fail(`Sudden death draws ${count} cards.`);
    for (const card of action.cards) takeCard(state, card);
    sd.cards = action.cards;
    state.phase = "suddenDeathOpen";
    return;
  }
  requirePhase(state, "suddenDeathOpen");
  if (action.playerId !== undefined && !sd.players.includes(action.playerId))
    fail(`${action.playerId} is not in the sudden death.`);
  if (action.type === "sdGuess") {
    once(sd.guesses, action.playerId);
    sd.guesses[action.playerId] = checkYear(action.year);
  } else if (action.type === "sdOrder") {
    once(sd.orders, action.playerId);
    if (!isPermutation(action.order, sd.cards.map((card) => card.cardId)))
      fail("An order lists every drawn card once.");
    sd.orders[action.playerId] = action.order;
  } else {
    if (sd.named) fail("The song was already named.");
    sd.named = true;
    sd.namedPlayer = action.playerId;
  }
}
function suddenDeathPending(sd: SuddenDeath): string[] {
  if (sd.kind === "closestYear") return sd.players.filter((id) => !has(sd.guesses, id));
  if (sd.kind === "lineup") return sd.players.filter((id) => !has(sd.orders, id));
  return [];
}
const suddenDeathReady = (sd: SuddenDeath): boolean =>
  sd.kind === "firstToName" ? sd.named : suddenDeathPending(sd).length === 0;
function suddenDeathReveal(state: GameState): void {
  const sd = state.sd!;
  if (!suddenDeathReady(sd)) fail("The reveal needs every input.");
  let best: string[];
  if (sd.kind === "firstToName")
    best = sd.namedPlayer === undefined ? sd.players : [sd.namedPlayer];
  else {
    const measure =
      sd.kind === "closestYear"
        ? (id: string) => -distance(sd.guesses[id], sd.cards[0].year)
        : (id: string) =>
            lineupPoints(
              sd.orders[id],
              Object.fromEntries(sd.cards.map((card) => [card.cardId, card.year])),
            );
    const top = Math.max(...sd.players.map(measure));
    best = sd.players.filter((id) => measure(id) === top);
  }
  const out = sd.players.filter((id) => !best.includes(id));
  if (out.length > 0) sd.eliminated.push(out);
  sd.players = best;
  clearSuddenDeathCard(sd);
  if (best.length === 1) {
    sd.winner = best[0];
    state.phase = "finished";
  } else state.phase = "suddenDeath";
}

// Summary (section 7).
export function summarize(state: GameState): Record<string, unknown> {
  const rules = rulesOf(state);
  const active = activePlayer(state);
  const sd = state.sd;
  return {
    phase: state.phase,
    round: state.round,
    scores: rules.rank
      ? Object.fromEntries(state.players.map((p) => [p.id, scoreOf(state, p.id)]))
      : {},
    standings: standings(state),
    ...(active !== undefined && { active }),
    ...(sd &&
      (state.phase === "suddenDeath" || state.phase === "suddenDeathOpen") && {
        suddenDeath: { kind: sd.kind, players: sd.players },
      }),
    ...structuredClone(rules.extras(state)),
    ...(state.chips && { chips: { ...state.chips } }),
  };
}

// Queries for the UI.
export function activePlayer(state: GameState): string | undefined {
  return rulesOf(state).hasActive && state.phase !== "finished"
    ? activeId(state)
    : undefined;
}
// Card references in play: the drawn card, set or pair, or the sudden-death cards.
export function currentCards(state: GameState): CardRef[] {
  if (state.phase === "suddenDeathOpen") return [...state.sd!.cards];
  if (state.phase !== "open") return [];
  const current = rulesOf(state).current;
  return current ? [...current(state)] : state.card ? [state.card] : [];
}
// Timeline: the player's (default: the active player's) or the shared timeline;
// Relay: the team's line. Other modes have none.
export function timelineOf(state: GameState, playerId?: string): CardRef[] {
  if (state.mode === "timeline") return [...timelineCards(state, playerId)];
  if (state.mode === "relay") return [...relayLine(state)];
  return [];
}
// Cards the current sudden death draws at once; 0 outside a sudden death.
export function suddenDeathCards(state: GameState): number {
  return state.sd ? rulesOf(state).suddenDeath!.count(state) : 0;
}
// Players who still owe the current input (including wagers), in turn order.
export function pendingInputs(state: GameState): string[] {
  if (state.phase === "suddenDeathOpen") return suddenDeathPending(state.sd!);
  if (state.phase !== "open") return [];
  const owing = new Set([...rulesOf(state).pending(state), ...missingWagers(state)]);
  return state.players.map((p) => p.id).filter((id) => owing.has(id));
}
export function canReveal(state: GameState): boolean {
  if (state.phase === "suddenDeathOpen") return suddenDeathReady(state.sd!);
  return (
    state.phase === "open" &&
    rulesOf(state).canReveal(state) &&
    missingWagers(state).length === 0
  );
}
