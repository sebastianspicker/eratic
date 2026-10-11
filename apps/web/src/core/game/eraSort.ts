import { ERA_IDS } from "../eras";
import { eraSortPoints } from "../scoring";
import type { EraSortOptions } from "../session";
import {
  drawCard,
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

// Era Sort (contract/game-rules.md section 6.2).
interface EraSortState {
  picks: Record<string, string>;
  rightEras: Record<string, number>;
}
const of = (state: GameState) => state.m as EraSortState;
const options = (state: GameState) => state.options as EraSortOptions;

export const eraSort: ModeRules = {
  players: [1, 10],
  start: "awaitingDraw",
  hasActive: false,
  suddenDeath: { kind: "closestYear", count: () => 1 },
  init: (state): EraSortState => ({ picks: {}, rightEras: perPlayer(state, 0) }),
  act(state, action) {
    const m = of(state);
    if (action.type === "draw") return drawCard(state, action.card);
    if (action.type !== "pickEra") unsupported(state, action);
    requirePhase(state, "open");
    once(m.picks, action.playerId);
    if (!ERA_IDS.includes(action.era)) fail(`Unknown era: ${action.era}.`);
    m.picks[action.playerId] = action.era;
  },
  canReveal: (state) => eraSort.pending(state).length === 0,
  pending: (state) => playerIds(state).filter((id) => !has(of(state).picks, id)),
  reveal(state) {
    const m = of(state);
    for (const [id, era] of Object.entries(m.picks)) {
      const points = eraSortPoints(era, state.card!.year, options(state).kids);
      state.points[id] += points;
      // A pick scoring 3 is a right era, including Kids' adjacent credit.
      if (points === 3) m.rightEras[id]++;
    }
    m.picks = {};
  },
  discard: (state) => {
    of(state).picks = {};
  },
  ended: (state) => state.round >= options(state).rounds,
  rank: (state, id, score) => [score, of(state).rightEras[id]],
  extras: (state) => ({ rightEras: of(state).rightEras }),
};
