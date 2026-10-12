import { higherLowerCorrect } from "../scoring";
import type { CardRef, HigherLowerOptions } from "../session";
import {
  activeId,
  drawCard,
  fail,
  has,
  nextTurn,
  once,
  perPlayer,
  playerIds,
  requireActive,
  requirePhase,
  takeCard,
  unsupported,
  type GameState,
  type ModeRules,
} from "./common";

// Higher or Lower, solo or versus, in turns or with everyone calling
// (contract/game-rules.md section 6.5).
type Call = "earlier" | "later";
interface HigherLowerState {
  reference?: CardRef;
  // turns: the active player's call.
  call?: Call;
  // everyone: one call per player still in, and each player's lives.
  calls: Record<string, Call>;
  lives?: Record<string, number>;
  streaks: Record<string, number>;
  eliminated: string[];
  // The reveal (1-based) that eliminated each player in eliminated.
  outAt: Record<string, number>;
  missed: boolean;
}
const of = (state: GameState) => state.m as HigherLowerState;
const options = (state: GameState) => state.options as HigherLowerOptions;
const everyone = (state: GameState) => options(state).play === "everyone";
const solo = (state: GameState) => state.players.length === 1;
const isOut = (state: GameState) => (id: string) => of(state).eliminated.includes(id);
// Players who still call: everyone not eliminated (a solo player out of lives
// has already ended the game).
const stillIn = (state: GameState) => playerIds(state).filter((id) => !isOut(state)(id));

export const higherLower: ModeRules = {
  players: [1, 6],
  start: "setup",
  hasActive: (state) => !everyone(state),
  init: (state): HigherLowerState => ({
    calls: {},
    ...(everyone(state) && { lives: perPlayer(state, options(state).lives!) }),
    streaks: perPlayer(state, 0),
    eliminated: [],
    outAt: {},
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
        m.calls = {};
        return;
      case "call":
        requirePhase(state, "open");
        if (everyone(state)) {
          if (isOut(state)(action.playerId)) fail(`${action.playerId} is out.`);
          once(m.calls, action.playerId);
        } else {
          requireActive(state, action.playerId);
          if (m.call) fail("The call is already made.");
        }
        if (action.call !== "earlier" && action.call !== "later")
          fail("A call is earlier or later.");
        if (everyone(state)) m.calls[action.playerId] = action.call;
        else m.call = action.call;
        return;
    }
    unsupported(state, action);
  },
  canReveal: (state) => higherLower.pending(state).length === 0,
  pending: (state) => {
    const m = of(state);
    if (everyone(state)) return stillIn(state).filter((id) => !has(m.calls, id));
    return m.call === undefined ? [activeId(state)] : [];
  },
  reveal(state) {
    const m = of(state);
    const reference = m.reference!.year;
    const year = state.card!.year;
    if (everyone(state)) {
      // Callers in turn order; eliminations in the same reveal follow it too.
      for (const id of stillIn(state)) {
        if (higherLowerCorrect(reference, year, m.calls[id])) m.streaks[id]++;
        else if (--m.lives![id] === 0) {
          if (solo(state)) m.missed = true;
          else {
            m.eliminated.push(id);
            m.outAt[id] = state.round + 1;
          }
        }
      }
      m.reference = state.card;
      m.calls = {};
      return;
    }
    const active = activeId(state);
    if (higherLowerCorrect(reference, year, m.call!)) m.streaks[active]++;
    else if (solo(state)) m.missed = true;
    else m.eliminated.push(active);
    m.reference = state.card;
    m.call = undefined;
    nextTurn(state, isOut(state));
  },
  discard: (state) => {
    of(state).call = undefined;
    of(state).calls = {};
  },
  ended(state) {
    const m = of(state);
    if (solo(state)) return m.missed;
    return (
      state.players.length - m.eliminated.length <= 1 ||
      state.round >= options(state).cards
    );
  },
  score: (state, id) => of(state).streaks[id],
  // turns: players still in first, by streak; then the eliminated, later first.
  // everyone: still in by streak, then lives; then the eliminated by the reveal
  // that eliminated them, later first, then streak.
  rank: (state, id) => {
    const m = of(state);
    if (everyone(state))
      return isOut(state)(id)
        ? [0, m.outAt[id], m.streaks[id]]
        : [1, m.streaks[id], m.lives![id]];
    const out = m.eliminated.indexOf(id);
    return out < 0 ? [1, m.streaks[id]] : [0, out];
  },
  extras: (state) => ({
    streaks: of(state).streaks,
    eliminated: of(state).eliminated,
    ...(of(state).reference && { reference: of(state).reference!.cardId }),
    ...(of(state).lives && { lives: of(state).lives }),
  }),
};
