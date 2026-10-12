import { eraOf } from "../eras";
import type {
  CardRef,
  GameAction,
  GameMode,
  ModeOptions,
  SessionPlayer,
} from "../session";

// State and helpers shared by the engine and the mode rules
// (contract/game-rules.md section 5). Mode files import only this module, so
// the engine can import every mode without an import cycle.
export class GameError extends Error {
  readonly actionIndex: number;
  constructor(message: string, actionIndex: number) {
    super(message);
    this.name = "GameError";
    this.actionIndex = actionIndex;
  }
}
// The engine replaces the index with the rejected action's index.
export function fail(message: string): never {
  throw new GameError(message, -1);
}

export type Phase =
  | "setup"
  | "awaitingDraw"
  | "open"
  | "suddenDeath"
  | "suddenDeathOpen"
  | "finished";
export type SuddenDeathKind = "closestYear" | "lineup" | "firstToName";
export interface SuddenDeath {
  kind: SuddenDeathKind;
  // Still tied, in turn order.
  players: string[];
  // One group per sudden-death round, oldest first.
  eliminated: string[][];
  // The main standings after the tied first group.
  rest: string[][];
  winner?: string;
  cards: CardRef[];
  guesses: Record<string, number>;
  orders: Record<string, string[]>;
  named: boolean;
  namedPlayer?: string;
}
// Plain JSON data, so applyAction can copy it with structuredClone.
export interface GameState {
  mode: GameMode;
  options: ModeOptions[GameMode];
  players: SessionPlayer[];
  seed: number;
  phase: Phase;
  round: number;
  lastAt: number;
  used: string[];
  turn: number;
  points: Record<string, number>;
  chips?: Record<string, number>;
  wagers: Record<string, number>;
  card?: CardRef;
  sd?: SuddenDeath;
  m: unknown;
}
export type ActionOf<T extends GameAction["type"]> = Extract<
  GameAction,
  { type: T }
>;

export interface ModeRules {
  players: [number, number];
  start: "setup" | "awaitingDraw";
  // Whether the mode has an active player; may depend on the options.
  hasActive: boolean | ((state: GameState) => boolean);
  suddenDeath?: { kind: SuddenDeathKind; count: (state: GameState) => number };
  init(state: GameState): unknown;
  // Mode actions; anything else is rejected.
  act(state: GameState, action: GameAction): void;
  canReveal(state: GameState): boolean;
  // Players who still owe the card's input (wagers are added by the engine).
  pending(state: GameState): string[];
  // Scores the card; the engine then counts the round, settles wagers and
  // clears the card.
  reveal(state: GameState): void;
  // Undoes every input given for the card in play.
  discard(state: GameState): void;
  ended(state: GameState): boolean;
  score?(state: GameState, playerId: string): number;
  // Ranking keys, larger is better; absent means the mode has no ranking.
  rank?(state: GameState, playerId: string, score: number): number[];
  extras(state: GameState): Record<string, unknown>;
  // Stakes: who must wager, whether a wager may be placed now, and who is right.
  wagerers?(state: GameState): string[];
  canWager?(state: GameState, playerId: string): boolean;
  right?(state: GameState, playerId: string): boolean;
  current?(state: GameState): CardRef[];
  onEnd?(state: GameState): void;
}

export const playerIds = (state: GameState): string[] =>
  state.players.map((player) => player.id);
export const activeId = (state: GameState): string =>
  state.players[state.turn].id;
export const perPlayer = <T>(state: GameState, value: T): Record<string, T> =>
  Object.fromEntries(state.players.map((player) => [player.id, value]));

export function requirePhase(state: GameState, ...phases: Phase[]): void {
  if (!phases.includes(state.phase))
    fail(`Not allowed in phase ${state.phase}.`);
}
export function requireActive(state: GameState, playerId: string): void {
  if (playerId !== activeId(state)) fail(`${playerId} is not the active player.`);
}
// Player and card IDs are exact strings and may be "toString" or "constructor",
// so per-player records are only read through own members (section 1.1).
export const has = (record: object, key: string): boolean => Object.hasOwn(record, key);
export const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined;
export function once(record: Record<string, unknown>, playerId: string): void {
  if (has(record, playerId)) fail(`${playerId} already gave this input.`);
}
export function checkYear(year: unknown): number {
  if (!Number.isInteger(year) || (year as number) < 1850 || (year as number) > 2100)
    fail("A year must be an integer from 1850 to 2100.");
  return year as number;
}
export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
export function checkCard(card: CardRef): void {
  if (typeof card !== "object" || card === null) fail("A card reference is an object.");
  if (typeof card.cardId !== "string" || !ID_PATTERN.test(card.cardId))
    fail(`Invalid card ID: ${String(card.cardId)}.`);
  checkYear(card.year);
  if (card.era !== eraOf(card.year))
    fail(`Card ${card.cardId}: era ${card.era} does not match ${card.year}.`);
}
// A card ID enters a session at most once (section 5.1).
export function takeCard(state: GameState, card: CardRef): void {
  checkCard(card);
  if (state.used.includes(card.cardId))
    fail(`Card ${card.cardId} is already used in this session.`);
  state.used.push(card.cardId);
}
export function drawCard(state: GameState, card: CardRef): void {
  requirePhase(state, "awaitingDraw");
  takeCard(state, card);
  state.card = card;
  state.phase = "open";
}
export function checkSlot(slot: number, length: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot > length)
    fail(`Slot ${slot} is outside 0 to ${length}.`);
}
export function isPermutation(order: readonly string[], ids: readonly string[]): boolean {
  return (
    Array.isArray(order) &&
    order.every((id) => typeof id === "string") &&
    order.length === ids.length &&
    new Set(order).size === order.length &&
    order.every((id) => ids.includes(id))
  );
}
// Passes the turn to the next player, wrapping around and skipping players out.
export function nextTurn(state: GameState, out: (id: string) => boolean = () => false): void {
  for (let step = 1; step <= state.players.length; step++) {
    const index = (state.turn + step) % state.players.length;
    if (!out(state.players[index].id)) {
      state.turn = index;
      return;
    }
  }
}
export function checkCards(cards: readonly CardRef[]): void {
  if (!Array.isArray(cards)) fail("cards must be a list.");
}
export function checkMarks(titleOK: unknown, artistOK: unknown): void {
  if (typeof titleOK !== "boolean" || typeof artistOK !== "boolean")
    fail("titleOK and artistOK are booleans.");
}
export function unsupported(state: GameState, action: GameAction): never {
  fail(`Action ${action.type} is not part of ${state.mode}.`);
}
export const cardYears = (cards: readonly CardRef[]): number[] =>
  cards.map((card) => card.year);
