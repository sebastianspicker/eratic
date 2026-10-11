import { sessionV1 as validateSchemaV1, sessionV2 as validateSchemaV2 } from "./generated/validators.js";
import { assertNoDuplicateNames, assertWellFormed } from "./deck";
import type { AnchorKind } from "./random";
import { isValidDate } from "./scoring";
import { replay, type GameState } from "./game/engine";

// Session file format versions 1 and 2 (contract/game-rules.md section 4).
export type GameMode =
  | "ladder"
  | "timeline"
  | "bullseye"
  | "eraSort"
  | "higherLower"
  | "relay"
  | "lineup"
  | "daily"
  | "imposter";
export interface CardRef {
  cardId: string;
  year: number;
  era: string;
}
export interface SessionPlayer {
  id: string;
  name: string;
  members?: string[];
}
type At = { at: number };
export type GameAction = At &
  (
    | { type: "clip"; fromMs: number; lengthMs?: number }
    | { type: "skip" }
    | { type: "end" }
    | { type: "draw"; card: CardRef }
    | { type: "reveal" }
    | { type: "wager"; playerId: string; chips: number }
    | { type: "sdDraw"; cards: CardRef[] }
    | { type: "sdGuess"; playerId: string; year: number }
    | { type: "sdOrder"; playerId: string; order: string[] }
    | { type: "sdName"; playerId?: string }
    | { type: "guess"; playerId: string; year: number }
    | { type: "pickEra"; playerId: string; era: string }
    | { type: "anchor"; playerId?: string; card: CardRef }
    | { type: "place"; playerId: string; slot: number }
    | { type: "challenge"; playerId: string; slot: number }
    | { type: "nameIt"; playerId: string; titleOK: boolean; artistOK: boolean }
    | { type: "step"; index: number }
    | { type: "lock"; playerId: string; year?: number }
    | { type: "mark"; playerId: string; titleOK: boolean; artistOK: boolean }
    | { type: "reference"; card: CardRef }
    | { type: "call"; playerId: string; call: "earlier" | "later" }
    | { type: "drawSet"; cards: CardRef[] }
    | { type: "order"; playerId: string; order: string[] }
    | { type: "drawPair"; a: CardRef; b: CardRef; original: "a" | "b" }
    | { type: "choose"; playerId: string; pick: "a" | "b"; year?: number }
  );
export type ActionType = GameAction["type"];

// Per-mode options after normalisation (section 6).
export interface BullseyeOptions {
  rounds: number;
  stakes: boolean;
}
export interface EraSortOptions {
  rounds: number;
  kids: boolean;
}
export interface TimelineOptions {
  ownership: "personal" | "shared";
  anchor: AnchorKind;
  anchorYear?: number;
  target: number;
  challenges: boolean;
  tokens: number;
  nameIt: boolean;
  stakes: boolean;
  clip: "full" | "30s" | "10s";
}
export interface LadderOptions {
  rounds: number;
  steps: number[];
  guess: "name" | "year" | "both";
  clipStart: "card" | "skipIntro" | "zero";
  stakes: boolean;
}
export interface HigherLowerOptions {
  cards: number;
}
export interface RelayOptions {
  target: number;
  lives: number;
  anchor: AnchorKind;
  anchorYear?: number;
  nameIt: boolean;
}
export interface LineupOptions {
  k: number;
  rounds: number;
  clipMs: number;
}
export interface DailyOptions {
  date: string;
  cards: string[];
}
export interface ImposterOptions {
  rounds: number;
}
export interface ModeOptions {
  bullseye: BullseyeOptions;
  eraSort: EraSortOptions;
  timeline: TimelineOptions;
  ladder: LadderOptions;
  higherLower: HigherLowerOptions;
  relay: RelayOptions;
  lineup: LineupOptions;
  daily: DailyOptions;
  imposter: ImposterOptions;
}
// The options member of a file: any mode's members, each optional.
export interface SessionOptions {
  rounds?: number;
  stakes?: boolean;
  kids?: boolean;
  ownership?: TimelineOptions["ownership"];
  anchor?: AnchorKind;
  anchorYear?: number;
  target?: number;
  challenges?: boolean;
  tokens?: number;
  nameIt?: boolean;
  clip?: TimelineOptions["clip"];
  steps?: number[];
  guess?: LadderOptions["guess"];
  clipStart?: LadderOptions["clipStart"];
  cards?: number | string[];
  lives?: number;
  k?: number;
  clipMs?: number;
  date?: string;
}
// Version 2 caps Snippet Ladder steps at 30 s; version 1 stays readable unchanged.
export type SessionVersion = 1 | 2;
export interface Session {
  format: "eratic-session";
  sessionVersion: SessionVersion;
  id: string;
  createdAt: string;
  deckId: string;
  deckTitle: string;
  mode: GameMode;
  options: SessionOptions;
  seed: number;
  players: SessionPlayer[];
  actions: GameAction[];
}

type Spec = { valid: (value: unknown) => boolean; fallback?: unknown };
const int = (min: number, max: number, fallback?: number): Spec => ({
  valid: (value) =>
    Number.isInteger(value) && (value as number) >= min && (value as number) <= max,
  fallback,
});
const bool = (fallback: boolean): Spec => ({
  valid: (value) => typeof value === "boolean",
  fallback,
});
const choice = (values: readonly string[], fallback: string): Spec => ({
  valid: (value) => values.includes(value as string),
  fallback,
});
const ANCHOR = choice(["beginning", "middle", "random", "custom"], "random");
const ANCHOR_YEAR = int(1850, 2100);
const steps = (max: number, fallback: number[]): Spec => ({
  valid: (value) =>
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 5 &&
    value.every(
      (step, i) =>
        Number.isInteger(step) &&
        step >= 500 &&
        step <= max &&
        (i === 0 || step > value[i - 1]),
    ),
  fallback,
});
const STEPS_V1 = steps(600000, [1000, 5000, 10000, 30000, 60000]);
const STEPS_V2 = steps(30000, [1000, 5000, 10000, 20000, 30000]);
export const LADDER_STEPS_DEFAULT: Record<SessionVersion, number[]> = {
  1: STEPS_V1.fallback as number[],
  2: STEPS_V2.fallback as number[],
};
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const DAILY_CARDS: Spec = {
  valid: (value) =>
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= 5 &&
    new Set(value).size === value.length &&
    value.every((id) => typeof id === "string" && ID.test(id)),
};
const DATE: Spec = {
  valid: (value) => typeof value === "string" && isValidDate(value),
};
const OPTION_SPECS: Record<GameMode, Record<string, Spec>> = {
  bullseye: { rounds: int(1, 100, 10), stakes: bool(false) },
  eraSort: { rounds: int(1, 100, 10), kids: bool(false) },
  timeline: {
    ownership: choice(["personal", "shared"], "personal"),
    anchor: ANCHOR,
    anchorYear: ANCHOR_YEAR,
    target: int(2, 30, 10),
    challenges: bool(true),
    tokens: int(0, 5, 2),
    nameIt: bool(false),
    stakes: bool(false),
    clip: choice(["full", "30s", "10s"], "full"),
  },
  ladder: {
    rounds: int(1, 100, 10),
    steps: STEPS_V2,
    guess: choice(["name", "year", "both"], "name"),
    clipStart: choice(["card", "skipIntro", "zero"], "card"),
    stakes: bool(false),
  },
  higherLower: { cards: int(2, 100, 10) },
  relay: {
    target: int(2, 30, 12),
    lives: int(1, 10, 3),
    anchor: ANCHOR,
    anchorYear: ANCHOR_YEAR,
    nameIt: bool(false),
  },
  lineup: { k: int(3, 5, 4), rounds: int(1, 20, 5), clipMs: int(1000, 60000, 10000) },
  daily: { date: DATE, cards: DAILY_CARDS },
  imposter: { rounds: int(1, 50, 5) },
};

// Defaults and range checks of section 6; throws on unknown members, values out
// of range, a missing required member, or anchorYear without a custom anchor.
export function normalizeOptions<M extends GameMode>(
  mode: M,
  options: SessionOptions,
  sessionVersion: SessionVersion = 2,
): ModeOptions[M] {
  if (!Object.hasOwn(OPTION_SPECS, mode)) throw new Error(`Unknown mode: ${String(mode)}.`);
  const specs =
    mode === "ladder" && sessionVersion === 1
      ? { ...OPTION_SPECS.ladder, steps: STEPS_V1 }
      : OPTION_SPECS[mode];
  if (typeof options !== "object" || options === null || Array.isArray(options))
    throw new Error("Options must be an object.");
  // Own members only: an option named "constructor" is unknown, not inherited.
  for (const name of Object.keys(options))
    if (!Object.hasOwn(specs, name))
      throw new Error(`Option ${name} is not used by ${mode}.`);
  const given = options as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const value = Object.hasOwn(given, name) ? given[name] : undefined;
    if (value === undefined) {
      if (spec.fallback !== undefined) result[name] = structuredClone(spec.fallback);
      else if (name !== "anchorYear")
        throw new Error(`Option ${name} is required in ${mode}.`);
    } else if (!spec.valid(value))
      throw new Error(`Option ${name} is out of range.`);
    else result[name] = structuredClone(value);
  }
  if (
    Object.hasOwn(specs, "anchor") &&
    (result.anchor === "custom") !== Object.hasOwn(result, "anchorYear")
  )
    throw new Error(
      "Option anchorYear is required with a custom anchor and forbidden otherwise.",
    );
  return result as unknown as ModeOptions[M];
}

export const MAX_SESSION_BYTES = 2 * 1024 * 1024;
function checkSessionSize(byteLength: number): void {
  if (byteLength > MAX_SESSION_BYTES)
    throw new Error("Session JSON exceeds 2 MiB.");
}
// A session is valid when it matches the schema and replays without error.
export function validateSession(input: unknown): Session {
  const version = (input as { sessionVersion?: unknown } | null)?.sessionVersion;
  const validateSchema = version === 1 ? validateSchemaV1 : validateSchemaV2;
  if (!validateSchema(input)) {
    const first = validateSchema.errors?.[0];
    throw new Error(
      `Invalid session: ${first?.instancePath || "/"} ${first?.message || `does not match session-v${version === 1 ? 1 : 2}`}.`,
    );
  }
  assertWellFormed(input, "session");
  replay(input);
  return input;
}
export function parseSession(json: string): Session {
  checkSessionSize(new TextEncoder().encode(json).byteLength);
  const value = JSON.parse(json) as unknown;
  assertNoDuplicateNames(json, "session");
  return validateSession(value);
}
// Strict UTF-8 like deck files (a leading BOM is ignored).
export function decodeSessionBytes(bytes: Uint8Array): Session {
  checkSessionSize(bytes.byteLength);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Invalid session: the file is not valid UTF-8.");
  }
  return parseSession(text);
}
export function exportSession(session: Session): string {
  const normalized: Session = {
    format: session.format,
    sessionVersion: session.sessionVersion,
    id: session.id,
    createdAt: session.createdAt,
    deckId: session.deckId,
    deckTitle: session.deckTitle,
    mode: session.mode,
    options: normalizeOptions(session.mode, session.options, session.sessionVersion) as SessionOptions,
    seed: session.seed,
    players: session.players,
    actions: session.actions,
  };
  const json = `${JSON.stringify(validateSession(normalized), null, 2)}\n`;
  checkSessionSize(new TextEncoder().encode(json).byteLength);
  return json;
}
// Card IDs that entered the session, in order: the host draws the first ID of
// drawOrder that is not among them.
export function usedCardIds(state: GameState): string[] {
  return [...state.used];
}
