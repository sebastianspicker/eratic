import { higherLowerCorrect } from "../scoring";
import type { CardRef, HigherLowerOptions } from "../session";
import {
  activeId,
  drawCard,
  fail,
  nextTurn,
  perPlayer,
  requireActive,
  requirePhase,
  takeCard,
  unsupported,
  type GameState,
  type ModeRules,
} from "./common";

// Higher or Lower, solo or versus (contract/game-rules.md section 6.5).
interface HigherLowerState {
  reference?: CardRef;
  call?: "earlier" | "later";
  streaks: Record<string, number>;
  eliminated: string[];
  missed: boolean;
}
const of = (state: GameState) => state.m as HigherLowerState;
const solo = (state: GameState) => state.players.length === 1;
const isOut = (state: GameState) => (id: string) => of(state).eliminated.includes(id);

export const higherLower: ModeRules = {
  players: [1, 6],
  start: "setup",
  hasActive: true,
  init: (state): HigherLowerState => ({
    streaks: perPlayer(state, 0),
    eliminated: [],
    missed: false,
  }),
  act(state, action) {
    const m = of(state);
    switch (action.type) {
      case "reference":
        requirePhase(state, "setup");
        takeCard(state, action.card);
        m.reference = action.card;
        state.phase = "awaitingDraw";
        return;
      case "draw":
        drawCard(state, action.card);
        m.call = undefined;
        return;
      case "call":
        requirePhase(state, "open");
        requireActive(state, action.playerId);
        if (m.call) fail("The call is already made.");
        if (action.call !== "earlier" && action.call !== "later")
          fail("A call is earlier or later.");
        m.call = action.call;
        return;
    }
    unsupported(state, action);
  },
  canReveal: (state) => of(state).call !== undefined,
  pending: (state) => (of(state).call === undefined ? [activeId(state)] : []),
  reveal(state) {
    const m = of(state);
    const active = activeId(state);
    if (higherLowerCorrect(m.reference!.year, state.card!.year, m.call!))
      m.streaks[active]++;
    else if (solo(state)) m.missed = true;
    else m.eliminated.push(active);
    m.reference = state.card;
    m.call = undefined;
    nextTurn(state, isOut(state));
  },
  discard: (state) => {
    of(state).call = undefined;
  },
  ended(state) {
    const m = of(state);
    if (solo(state)) return m.missed;
    return (
      state.players.length - m.eliminated.length <= 1 ||
      state.round >= (state.options as HigherLowerOptions).cards
    );
  },
  score: (state, id) => of(state).streaks[id],
  // Players still in first, by streak; then the eliminated, later first.
  rank: (state, id) => {
    const out = of(state).eliminated.indexOf(id);
    return out < 0 ? [1, of(state).streaks[id]] : [0, out];
  },
  extras: (state) => ({
    streaks: of(state).streaks,
    eliminated: of(state).eliminated,
    ...(of(state).reference && { reference: of(state).reference!.cardId }),
  }),
};
