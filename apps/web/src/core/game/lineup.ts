import { lineupPoints } from "../scoring";
import type { CardRef, LineupOptions } from "../session";
import {
  checkCards,
  fail,
  isPermutation,
  has,
  once,
  perPlayer,
  playerIds,
  requirePhase,
  takeCard,
  unsupported,
  type GameState,
  type ModeRules,
} from "./common";

// Lineup (contract/game-rules.md section 6.7).
interface LineupState {
  set: CardRef[];
  orders: Record<string, string[]>;
  perfect: Record<string, number>;
}
const of = (state: GameState) => state.m as LineupState;
const options = (state: GameState) => state.options as LineupOptions;

export const lineup: ModeRules = {
  players: [1, 6],
  start: "awaitingDraw",
  hasActive: false,
  suddenDeath: { kind: "lineup", count: (state) => options(state).k },
  init: (state): LineupState => ({ set: [], orders: {}, perfect: perPlayer(state, 0) }),
  act(state, action) {
    const m = of(state);
    if (action.type === "drawSet") {
      requirePhase(state, "awaitingDraw");
      checkCards(action.cards);
      if (action.cards.length !== options(state).k)
        fail(`A lineup has exactly ${options(state).k} cards.`);
      for (const card of action.cards) takeCard(state, card);
      m.set = action.cards;
      m.orders = {};
      state.phase = "open";
      return;
    }
    if (action.type !== "order") unsupported(state, action);
    requirePhase(state, "open");
    once(m.orders, action.playerId);
    if (!isPermutation(action.order, m.set.map((card) => card.cardId)))
      fail("An order lists every card of the set once.");
    m.orders[action.playerId] = action.order;
  },
  canReveal: (state) => lineup.pending(state).length === 0,
  pending: (state) => playerIds(state).filter((id) => !has(of(state).orders, id)),
  reveal(state) {
    const m = of(state);
    const years = Object.fromEntries(m.set.map((card) => [card.cardId, card.year]));
    const k = m.set.length;
    for (const [id, order] of Object.entries(m.orders)) {
      const points = lineupPoints(order, years);
      state.points[id] += points;
      if (points === (k * (k - 1)) / 2 + 2) m.perfect[id]++;
    }
    m.set = [];
    m.orders = {};
  },
  discard: (state) => {
    of(state).set = [];
    of(state).orders = {};
  },
  ended: (state) => state.round >= options(state).rounds,
  rank: (state, id, score) => [score, of(state).perfect[id]],
  extras: (state) => ({ perfect: of(state).perfect }),
  current: (state) => of(state).set,
};
