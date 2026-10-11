import { ERA_IDS } from "../eras";
import {
  bullseyePoints,
  dailyMaxScore,
  dailyRoundKind,
  dailyShareText,
  eraSortPoints,
} from "../scoring";
import type { DailyOptions } from "../session";
import {
  checkCard,
  checkYear,
  drawCard,
  fail,
  has,
  once,
  playerIds,
  requirePhase,
  unsupported,
  type GameState,
  type ModeRules,
} from "./common";

// Daily Eratic: rounds 1-3 Era Sort, later rounds Bullseye (contract/game-rules.md section 6.8).
interface DailyState {
  inputs: Record<string, string | number>;
  eras: string[];
}
const of = (state: GameState) => state.m as DailyState;
const options = (state: GameState) => state.options as DailyOptions;
// The card in play belongs to round state.round + 1.
const eraRound = (state: GameState) => dailyRoundKind(state.round + 1) === "eraSort";

export const daily: ModeRules = {
  players: [1, 1],
  start: "awaitingDraw",
  hasActive: false,
  init: (): DailyState => ({ inputs: {}, eras: [] }),
  act(state, action) {
    const m = of(state);
    switch (action.type) {
      case "draw":
        if (state.phase === "awaitingDraw") checkCard(action.card);
        if (
          state.phase === "awaitingDraw" &&
          action.card.cardId !== options(state).cards[state.round]
        )
          fail(`Round ${state.round + 1} plays ${options(state).cards[state.round]}.`);
        drawCard(state, action.card);
        m.inputs = {};
        return;
      case "pickEra":
        requirePhase(state, "open");
        if (!eraRound(state)) fail("Rounds after 3 are Bullseye.");
        once(m.inputs, action.playerId);
        if (!ERA_IDS.includes(action.era)) fail(`Unknown era: ${action.era}.`);
        m.inputs[action.playerId] = action.era;
        return;
      case "guess":
        requirePhase(state, "open");
        if (eraRound(state)) fail("Rounds 1 to 3 are Era Sort.");
        once(m.inputs, action.playerId);
        m.inputs[action.playerId] = checkYear(action.year);
        return;
    }
    unsupported(state, action);
  },
  canReveal: (state) => daily.pending(state).length === 0,
  pending: (state) => playerIds(state).filter((id) => !has(of(state).inputs, id)),
  reveal(state) {
    const m = of(state);
    const card = state.card!;
    for (const [id, input] of Object.entries(m.inputs))
      state.points[id] +=
        typeof input === "string"
          ? eraSortPoints(input, card.year, false)
          : bullseyePoints(input, card.year);
    m.eras.push(card.era);
    m.inputs = {};
  },
  discard: (state) => {
    of(state).inputs = {};
  },
  ended: (state) => state.round >= options(state).cards.length,
  rank: (_state, _id, score) => [score],
  extras(state) {
    const maxScore = dailyMaxScore(options(state).cards.length);
    const eras = of(state).eras;
    return {
      maxScore,
      eras,
      ...(state.phase === "finished" && {
        shareText: dailyShareText(
          options(state).date,
          state.points[state.players[0].id],
          maxScore,
          eras,
        ),
      }),
    };
  },
};
