import { insertionIndex, nameItAward, placementCorrect } from "../scoring";
import type { CardRef, TimelineOptions } from "../session";
import {
  activeId,
  cardYears,
  checkMarks,
  checkSlot,
  drawCard,
  fail,
  nextTurn,
  own,
  perPlayer,
  requireActive,
  requirePhase,
  takeCard,
  unsupported,
  type GameState,
  type ModeRules,
} from "./common";

// Timeline, personal or shared (contract/game-rules.md section 6.3).
interface TimelineState {
  lines: Record<string, CardRef[]>;
  line: CardRef[];
  anchors: number;
  added: Record<string, number>;
  tokens: Record<string, number>;
  wrong: Record<string, number>;
  placed?: number;
  challenges: { playerId: string; slot: number }[];
  named?: { titleOK: boolean; artistOK: boolean };
  finalRound: boolean;
  endNow: boolean;
}
const of = (state: GameState) => state.m as TimelineState;
const options = (state: GameState) => state.options as TimelineOptions;
const personal = (state: GameState) => options(state).ownership === "personal";
const lineOf = (state: GameState, playerId: string): CardRef[] =>
  personal(state) ? own(of(state).lines, playerId) ?? [] : of(state).line;
function resetTurn(m: TimelineState): void {
  m.placed = undefined;
  m.challenges = [];
  m.named = undefined;
}
function requirePlaced(state: GameState): number {
  requirePhase(state, "open");
  const placed = of(state).placed;
  if (placed === undefined) fail("Allowed only after the placement.");
  return placed;
}

export const timeline: ModeRules = {
  players: [2, 8],
  start: "setup",
  hasActive: true,
  suddenDeath: { kind: "lineup", count: () => 4 },
  init: (state): TimelineState => ({
    lines: Object.fromEntries(state.players.map((p) => [p.id, []])),
    line: [],
    anchors: 0,
    added: perPlayer(state, 0),
    tokens: perPlayer(state, options(state).tokens),
    wrong: perPlayer(state, 0),
    challenges: [],
    finalRound: false,
    endNow: false,
  }),
  act(state, action) {
    const m = of(state);
    switch (action.type) {
      case "anchor": {
        requirePhase(state, "setup");
        if (personal(state)) {
          // One anchor per player, in turn order.
          if (action.playerId !== state.players[m.anchors].id)
            fail("Personal anchors go to each player in turn order.");
          takeCard(state, action.card);
          m.lines[action.playerId] = [action.card];
        } else {
          if (action.playerId !== undefined)
            fail("The shared anchor has no player.");
          takeCard(state, action.card);
          m.line = [action.card];
        }
        m.anchors++;
        if (!personal(state) || m.anchors === state.players.length)
          state.phase = "awaitingDraw";
        return;
      }
      case "draw":
        drawCard(state, action.card);
        resetTurn(m);
        return;
      case "place":
        requirePhase(state, "open");
        requireActive(state, action.playerId);
        if (m.placed !== undefined) fail("The card is already placed.");
        checkSlot(action.slot, lineOf(state, action.playerId).length);
        m.placed = action.slot;
        return;
      case "challenge": {
        const placed = requirePlaced(state);
        if (!options(state).challenges) fail("Challenges are off.");
        if (action.playerId === activeId(state))
          fail("The active player can't challenge.");
        if (m.tokens[action.playerId] < 1) fail("A challenge needs a token.");
        if (m.challenges.some((c) => c.playerId === action.playerId))
          fail("One challenge per player per turn.");
        checkSlot(action.slot, lineOf(state, activeId(state)).length);
        if (action.slot === placed || m.challenges.some((c) => c.slot === action.slot))
          fail("A challenge needs a slot nobody chose this turn.");
        m.tokens[action.playerId]--;
        m.challenges.push({ playerId: action.playerId, slot: action.slot });
        return;
      }
      case "nameIt":
        requirePlaced(state);
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
    const active = activeId(state);
    const line = lineOf(state, active);
    const years = cardYears(line);
    if (placementCorrect(years, m.placed!, card.year)) {
      line.splice(m.placed!, 0, card);
      if (!personal(state)) m.added[active]++;
    } else {
      const taker = m.challenges.find((c) => placementCorrect(years, c.slot, card.year));
      if (!taker) m.wrong[active]++;
      else if (personal(state)) {
        const own = m.lines[taker.playerId];
        own.splice(insertionIndex(cardYears(own), card.year), 0, card);
      } else {
        line.splice(taker.slot, 0, card);
        m.added[taker.playerId]++;
      }
    }
    if (m.named && nameItAward(m.named.titleOK, m.named.artistOK))
      m.tokens[active] = Math.min(5, m.tokens[active] + 1);
    const target = options(state).target;
    if (
      personal(state)
        ? Object.values(m.lines).some((own) => own.length >= target)
        : m.line.length >= target
    )
      m.finalRound = true;
    // The round is complete at the reveal of the last player in turn order.
    m.endNow = m.finalRound && state.turn === state.players.length - 1;
    resetTurn(m);
    nextTurn(state);
  },
  discard(state) {
    const m = of(state);
    for (const c of m.challenges) m.tokens[c.playerId]++;
    resetTurn(m);
  },
  ended: (state) => of(state).endNow,
  score: (state, id) =>
    personal(state) ? of(state).lines[id].length : of(state).added[id],
  rank: (state, id, score) => [score, -of(state).wrong[id]],
  extras(state) {
    const m = of(state);
    const ids = (cards: CardRef[]) => cards.map((card) => card.cardId);
    return {
      ...(personal(state)
        ? {
            timelines: Object.fromEntries(
              state.players.map((p) => [p.id, ids(m.lines[p.id])]),
            ),
          }
        : { timeline: ids(m.line) }),
      tokens: m.tokens,
      wrong: m.wrong,
    };
  },
  wagerers: (state) => [activeId(state)],
  canWager: (state) => of(state).placed !== undefined,
  right: (state) =>
    placementCorrect(
      cardYears(lineOf(state, activeId(state))),
      of(state).placed!,
      state.card!.year,
    ),
};

export function timelineCards(state: GameState, playerId?: string): CardRef[] {
  return lineOf(state, playerId ?? activeId(state));
}
