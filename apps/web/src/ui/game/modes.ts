import type { Card, Deck } from "../../core/deck";
import { imposterPairs } from "../../core/scoring";
import type { GameMode, SessionOptions } from "../../core/session";
import { previewUrl } from "./SnippetPreview";

// Display metadata for the nine modes of docs/game-modes.md, in gallery order.
// Player ranges and option ranges restate contract/game-rules.md section 6 for
// the controls; the engine still checks them.
export interface ModeInfo {
  name: string;
  pitch: string;
  players: [number, number];
  // Rounds of play are counted with this option, if any.
  roundsOption?: "rounds" | "cards";
}
export const MODE_ORDER: GameMode[] = [
  "ladder",
  "timeline",
  "bullseye",
  "eraSort",
  "higherLower",
  "relay",
  "lineup",
  "daily",
  "imposter",
];
export const MODE_INFO: Record<GameMode, ModeInfo> = {
  ladder: {
    name: "Snippet Ladder",
    pitch: "Name the song from as little as one second. The fewer seconds you need, the more points you score.",
    players: [1, 8],
    roundsOption: "rounds",
  },
  timeline: {
    name: "Timeline",
    pitch: "Build your own line of songs in release order; misplace one and it's gone.",
    players: [2, 8],
  },
  bullseye: {
    name: "Bullseye",
    pitch: "Everyone guesses the year; the closest guess scores the most.",
    players: [1, 10],
    roundsOption: "rounds",
  },
  eraSort: {
    name: "Era Sort",
    pitch: "Which era does this song belong to? The fastest way into Eratic.",
    players: [1, 10],
    roundsOption: "rounds",
  },
  higherLower: {
    name: "Higher or Lower",
    pitch: "Earlier or later than the last song? Keep the streak alive.",
    players: [1, 6],
  },
  relay: {
    name: "Relay",
    pitch: "One shared line, one team, a few lives. Debate every placement together.",
    players: [2, 10],
  },
  lineup: {
    name: "Lineup",
    pitch: "Hear four or five songs, then put them all in order.",
    players: [1, 6],
    roundsOption: "rounds",
  },
  daily: {
    name: "Daily Eratic",
    pitch: "One short round a day, played solo, with a result to share.",
    players: [1, 1],
  },
  imposter: {
    name: "Original or Imposter",
    pitch: "Two versions of one song; spot the original.",
    players: [2, 8],
    roundsOption: "rounds",
  },
};

export const isEasy = (card: Card): boolean =>
  card.difficulty !== undefined && card.difficulty <= 2;
export const hasDifficulty = (deck: Deck): boolean =>
  deck.cards.some((card) => card.difficulty !== undefined);

// Cards a game needs before it can start: anchors plus one card to draw
// (Timeline, Relay), a reference plus one (Higher or Lower), a whole lineup, a
// pair, or one card. Original or Imposter also needs a linked pair.
export function cardsNeeded(mode: GameMode, options: SessionOptions, players: number): number {
  switch (mode) {
    case "timeline":
      return (options.ownership ?? "personal") === "personal" ? players + 1 : 2;
    case "relay":
    case "higherLower":
    case "imposter":
      return 2;
    case "lineup":
      return options.k ?? 4;
    default:
      return 1;
  }
}

// Whether a mode can start with this deck and playback, and why not, in words.
// The gallery checks the smallest game the mode allows; Start checks the chosen one.
export function modeAvailability(
  mode: GameMode,
  deck: Deck,
  exact: boolean,
): { reason?: string; label?: string } {
  const smallest = cardsNeeded(mode, mode === "lineup" ? { k: 3 } : {}, MODE_INFO[mode].players[0]);
  if (deck.cards.length < smallest) return { reason: "Deck too small" };
  // Without exact clips, Snippet Ladder and Original or Imposter play by hand from the song backup.
  if (mode === "imposter" && imposterPairs(deck.cards, 0).length === 0) return { reason: "Needs linked recordings" };
  // Lineup plays preview snippets when any card has a Spotify/Apple Music preview
  // (provider-agnostic, like Lineup.tsx and the native SongBackup.hasSnippet).
  if (mode === "lineup" && !exact && !deck.cards.some((card) => previewUrl(card, undefined) !== undefined))
    return { label: "Lineup by name" };
  return {};
}

// Setup controls per mode with the contract defaults and ranges.
export type OptionField = {
  name: keyof SessionOptions;
  label: string;
  when?: (options: SessionOptions) => boolean;
  // Sent only when it differs from the fallback, so sessions stay minimal (version 2 additions).
  sparse?: boolean;
} & (
  | { kind: "int"; min: number; max: number; fallback: number; scale?: number }
  | { kind: "bool"; fallback: boolean }
  | { kind: "choice"; fallback: string; choices: [string, string][] }
  | { kind: "steps"; fallback: number[]; choices: number[] }
);
const rounds = (max: number, label = "Rounds", fallback = 10): OptionField => ({
  name: "rounds",
  label,
  kind: "int",
  min: 1,
  max,
  fallback,
});
const stakes: OptionField = {
  name: "stakes",
  label: "Stakes: wager 1 to 3 chips on each card",
  kind: "bool",
  fallback: false,
};
const anchor: OptionField[] = [
  {
    name: "anchor",
    label: "First card",
    kind: "choice",
    fallback: "random",
    choices: [
      ["beginning", "From the earliest songs"],
      ["middle", "From the middle"],
      ["random", "Any song"],
      ["custom", "Closest to a year"],
    ],
  },
  {
    name: "anchorYear",
    label: "Year for the first card",
    kind: "int",
    min: 1850,
    max: 2100,
    fallback: 1980,
    when: (options) => options.anchor === "custom",
  },
];
const nameIt: OptionField = {
  name: "nameIt",
  label: "Name It: title and artist right earns a bonus",
  kind: "bool",
  fallback: false,
};
export const OPTION_FIELDS: Record<GameMode, OptionField[]> = {
  ladder: [
    rounds(100, "Cards"),
    {
      name: "steps",
      label: "Clip steps",
      kind: "steps",
      fallback: [1000, 5000, 10000, 20000, 30000],
      choices: [1000, 5000, 10000, 20000, 30000],
    },
    {
      name: "guess",
      label: "Players guess",
      kind: "choice",
      fallback: "name",
      choices: [
        ["name", "Title and artist"],
        ["year", "The year"],
        ["both", "Both"],
      ],
    },
    {
      name: "clipStart",
      label: "Clip start",
      kind: "choice",
      fallback: "card",
      choices: [
        ["card", "The card's value"],
        ["skipIntro", "Skip the intro (15 s)"],
        ["zero", "The beginning"],
      ],
    },
    stakes,
    {
      name: "buzzer",
      label: "Buzzer: +2 for the first right lock-in",
      kind: "bool",
      fallback: false,
      sparse: true,
    },
  ],
  timeline: [
    {
      name: "ownership",
      label: "Lines",
      kind: "choice",
      fallback: "personal",
      choices: [
        ["personal", "Each player builds their own"],
        ["shared", "One shared line"],
      ],
    },
    ...anchor,
    { name: "target", label: "Cards to win", kind: "int", min: 2, max: 30, fallback: 10 },
    { name: "challenges", label: "Challenges", kind: "bool", fallback: true },
    { name: "tokens", label: "Tokens per player", kind: "int", min: 0, max: 5, fallback: 2 },
    nameIt,
    stakes,
    {
      name: "clip",
      label: "Clip length",
      kind: "choice",
      fallback: "full",
      choices: [
        ["full", "Whole song"],
        ["30s", "30 seconds"],
        ["10s", "10 seconds"],
      ],
    },
  ],
  bullseye: [rounds(100), stakes],
  eraSort: [
    rounds(100),
    {
      name: "kids",
      label: "Kids: a neighbouring era scores in full",
      kind: "bool",
      fallback: false,
    },
  ],
  higherLower: [
    {
      name: "cards",
      label: "Cards in versus play",
      kind: "int",
      min: 2,
      max: 100,
      fallback: 10,
    },
    {
      name: "play",
      label: "Who calls each card",
      kind: "choice",
      fallback: "turns",
      sparse: true,
      choices: [
        ["turns", "Take turns"],
        ["everyone", "Everyone, with lives"],
      ],
    },
    {
      name: "lives",
      label: "Lives",
      kind: "int",
      min: 1,
      max: 5,
      fallback: 3,
      when: (options) => options.play === "everyone",
    },
    {
      name: "closer",
      label: "Closer years as the game goes on",
      kind: "bool",
      fallback: false,
      sparse: true,
    },
  ],
  relay: [
    { name: "target", label: "Cards to win", kind: "int", min: 2, max: 30, fallback: 12 },
    { name: "lives", label: "Lives", kind: "int", min: 1, max: 10, fallback: 3 },
    ...anchor,
    nameIt,
  ],
  lineup: [
    { name: "k", label: "Songs per lineup", kind: "int", min: 3, max: 5, fallback: 4 },
    rounds(20, "Lineups", 5),
    {
      name: "clipMs",
      label: "Clip length (seconds)",
      kind: "int",
      min: 1,
      max: 60,
      fallback: 10,
      scale: 1000,
    },
  ],
  daily: [],
  imposter: [rounds(50, "Pairs", 5)],
};
export function defaultOptions(mode: GameMode): SessionOptions {
  const options: Record<string, unknown> = {};
  for (const field of OPTION_FIELDS[mode])
    options[field.name] =
      field.kind === "int" && field.scale
        ? field.fallback * field.scale
        : structuredClone(field.fallback);
  return options as SessionOptions;
}
// Drops fields that don't apply (anchorYear without a custom anchor) and
// sparse ones left at their default.
export function sessionOptions(mode: GameMode, options: SessionOptions): SessionOptions {
  const result: Record<string, unknown> = {};
  for (const field of OPTION_FIELDS[mode])
    if (!field.when || field.when(options)) {
      const value = options[field.name];
      if (field.sparse && (value === undefined || value === field.fallback)) continue;
      result[field.name] = value;
    }
  return result as SessionOptions;
}
