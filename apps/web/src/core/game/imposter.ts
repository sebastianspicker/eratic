import { compareCodePoints } from "../random";
import { distance, imposterPoints } from "../scoring";
import type { CardRef, ImposterOptions } from "../session";
import {
  checkCard,
  checkYear,
  fail,
  has,
  once,
  perPlayer,
  playerIds,
  requirePhase,
  unsupported,
  type GameState,
  type ModeRules,
} from "./common";

// Original or Imposter (contract/game-rules.md section 6.9).
interface ImposterState {
  pair?: { a: CardRef; b: CardRef; original: "a" | "b" };
  pairs: string[];
  choices: Record<string, { pick: "a" | "b"; year?: number }>;
  bonuses: Record<string, number>;
}
const of = (state: GameState) => state.m as ImposterState;

export const imposter: ModeRules = {
  players: [2, 8],
  start: "awaitingDraw",
  hasActive: false,
  init: (state): ImposterState => ({ pairs: [], choices: {}, bonuses: perPlayer(state, 0) }),
  act(state, action) {
    const m = of(state);
    if (action.type === "drawPair") {
      requirePhase(state, "awaitingDraw");
      const { a, b, original } = action;
      checkCard(a);
      checkCard(b);
      if (a.cardId === b.cardId) fail("A pair has two different cards.");
      if (original !== "a" && original !== "b") fail("The original is a or b.");
      // A card may appear in several pairs; the same two cards only once.
      const key = [a.cardId, b.cardId].sort(compareCodePoints).join("/");
      if (m.pairs.includes(key)) fail("These two cards were already paired.");
      m.pairs.push(key);
      for (const id of [a.cardId, b.cardId])
        if (!state.used.includes(id)) state.used.push(id);
      m.pair = { a, b, original };
      m.choices = {};
      state.phase = "open";
      return;
    }
    if (action.type !== "choose") unsupported(state, action);
    requirePhase(state, "open");
    once(m.choices, action.playerId);
    if (action.pick !== "a" && action.pick !== "b") fail("A pick is a or b.");
    if (action.year !== undefined) checkYear(action.year);
    m.choices[action.playerId] = {
      pick: action.pick,
      ...(action.year !== undefined && { year: action.year }),
    };
  },
  canReveal: (state) => imposter.pending(state).length === 0,
  pending: (state) => playerIds(state).filter((id) => !has(of(state).choices, id)),
  reveal(state) {
    const m = of(state);
    const pair = m.pair!;
    const originalYear = pair[pair.original].year;
    for (const [id, choice] of Object.entries(m.choices)) {
      state.points[id] += imposterPoints(
        choice.pick === pair.original,
        choice.year,
        originalYear,
      );
      if (choice.year !== undefined && distance(choice.year, originalYear) <= 2)
        m.bonuses[id]++;
    }
    m.pair = undefined;
    m.choices = {};
  },
  discard: (state) => {
    of(state).pair = undefined;
    of(state).choices = {};
  },
  ended: (state) => state.round >= (state.options as ImposterOptions).rounds,
  rank: (state, id, score) => [score, of(state).bonuses[id]],
  extras: (state) => ({ bonuses: of(state).bonuses }),
  current: (state) => (of(state).pair ? [of(state).pair!.a, of(state).pair!.b] : []),
};
