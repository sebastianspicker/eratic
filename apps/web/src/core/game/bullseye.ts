import { bullseyePoints, distance } from "../scoring";
import type { BullseyeOptions } from "../session";
import {
  checkYear,
  drawCard,
  has,
  once,
  perPlayer,
  playerIds,
  requirePhase,
  unsupported,
  type GameState,
  type ModeRules,
} from "./common";

// Bullseye (contract/game-rules.md section 6.1).
interface BullseyeState {
  guesses: Record<string, number>;
  exact: Record<string, number>;
  distance: Record<string, number>;
}
const of = (state: GameState) => state.m as BullseyeState;
const options = (state: GameState) => state.options as BullseyeOptions;

export const bullseye: ModeRules = {
  players: [1, 10],
  start: "awaitingDraw",
  hasActive: false,
  suddenDeath: { kind: "closestYear", count: () => 1 },
  init: (state): BullseyeState => ({
    guesses: {},
    exact: perPlayer(state, 0),
    distance: perPlayer(state, 0),
  }),
  act(state, action) {
    const m = of(state);
    if (action.type === "draw") return drawCard(state, action.card);
    if (action.type !== "guess") unsupported(state, action);
    requirePhase(state, "open");
    once(m.guesses, action.playerId);
    m.guesses[action.playerId] = checkYear(action.year);
  },
  canReveal: (state) => bullseye.pending(state).length === 0,
  pending: (state) => playerIds(state).filter((id) => !has(of(state).guesses, id)),
  reveal(state) {
    const m = of(state);
    const year = state.card!.year;
    for (const [id, guess] of Object.entries(m.guesses)) {
      state.points[id] += bullseyePoints(guess, year);
      if (guess === year) m.exact[id]++;
      m.distance[id] += distance(guess, year);
    }
    m.guesses = {};
  },
  discard: (state) => {
    of(state).guesses = {};
  },
  ended: (state) => state.round >= options(state).rounds,
  rank: (state, id, score) => [score, of(state).exact[id], -of(state).distance[id]],
  extras: (state) => ({ exact: of(state).exact, distance: of(state).distance }),
  wagerers: playerIds,
  right: (state, id) => distance(of(state).guesses[id], state.card!.year) <= 3,
};
