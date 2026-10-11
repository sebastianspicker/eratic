import { nameItAward, placementCorrect } from "../scoring";
import type { CardRef, RelayOptions } from "../session";
import {
  activeId,
  cardYears,
  checkMarks,
  checkSlot,
  drawCard,
  fail,
  nextTurn,
  requireActive,
  requirePhase,
  takeCard,
  unsupported,
  type GameState,
  type ModeRules,
} from "./common";

// Relay, one team on one shared line (contract/game-rules.md section 6.6).
interface RelayState {
  line: CardRef[];
  lives: number;
  placed?: number;
  named?: { titleOK: boolean; artistOK: boolean };
  outcome: "playing" | "won" | "lost" | "ended";
}
const of = (state: GameState) => state.m as RelayState;
const options = (state: GameState) => state.options as RelayOptions;
function resetTurn(m: RelayState): void {
  m.placed = undefined;
  m.named = undefined;
}

export const relay: ModeRules = {
  players: [2, 10],
  start: "setup",
  hasActive: true,
  init: (state): RelayState => ({
    line: [],
    lives: options(state).lives,
    outcome: "playing",
  }),
  act(state, action) {
    const m = of(state);
    switch (action.type) {
      case "anchor":
        requirePhase(state, "setup");
        if (action.playerId !== undefined) fail("The relay anchor has no player.");
        takeCard(state, action.card);
        m.line = [action.card];
        state.phase = "awaitingDraw";
        return;
      case "draw":
        drawCard(state, action.card);
        resetTurn(m);
        return;
      case "place":
        requirePhase(state, "open");
        requireActive(state, action.playerId);
        if (m.placed !== undefined) fail("The card is already placed.");
        checkSlot(action.slot, m.line.length);
        m.placed = action.slot;
        return;
      case "nameIt":
        requirePhase(state, "open");
        if (m.placed === undefined) fail("Name It follows the placement.");
        if (!options(state).nameIt) fail("Name It is off.");
        requireActive(state, action.playerId);
        if (m.named) fail("Name It was already judged.");
        checkMarks(action.titleOK, action.artistOK);
        m.named = { titleOK: action.titleOK, artistOK: action.artistOK };
        return;
    }
    unsupported(state, action);
  },
  canReveal: (state) => of(state).placed !== undefined,
  pending: (state) => (of(state).placed === undefined ? [activeId(state)] : []),
  reveal(state) {
    const m = of(state);
    const card = state.card!;
    // Name It is judged before the reveal, so it applies first.
    if (m.named && nameItAward(m.named.titleOK, m.named.artistOK))
      m.lives = Math.min(options(state).lives, m.lives + 1);
    if (placementCorrect(cardYears(m.line), m.placed!, card.year))
      m.line.splice(m.placed!, 0, card);
    else m.lives--;
    if (m.lives === 0) m.outcome = "lost";
    else if (m.line.length >= options(state).target) m.outcome = "won";
    resetTurn(m);
    nextTurn(state);
  },
  discard: (state) => resetTurn(of(state)),
  ended: (state) => of(state).outcome !== "playing",
  onEnd: (state) => {
    of(state).outcome = "ended";
  },
  extras: (state) => {
    const m = of(state);
    return {
      lives: m.lives,
      timeline: m.line.map((card) => card.cardId),
      teamScore: m.lives * 10 + m.line.length,
      outcome: m.outcome,
    };
  },
};

export const relayLine = (state: GameState): CardRef[] => of(state).line;
