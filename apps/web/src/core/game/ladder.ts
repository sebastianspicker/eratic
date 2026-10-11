import {
  ladderPoints,
  ladderYearBonus,
  ladderYearPoints,
} from "../scoring";
import type { LadderOptions } from "../session";
import {
  checkMarks,
  checkYear,
  drawCard,
  fail,
  has,
  once,
  own,
  perPlayer,
  playerIds,
  requirePhase,
  unsupported,
  type GameState,
  type ModeRules,
} from "./common";

// Snippet Ladder (contract/game-rules.md section 6.4).
interface LadderState {
  step: number;
  locks: Record<string, { step: number; year?: number }>;
  marks: Record<string, { titleOK: boolean; artistOK: boolean }>;
  usedMs: Record<string, number>;
  exactYears: Record<string, number>;
}
const of = (state: GameState) => state.m as LadderState;
const options = (state: GameState) => state.options as LadderOptions;
const last = (state: GameState) => options(state).steps.length - 1;
const marked = (state: GameState) => options(state).guess !== "year";

function cardPoints(state: GameState, id: string): number {
  const m = of(state);
  const lock = own(m.locks, id);
  if (!lock) return 0;
  const answer = state.card!.year;
  const guess = options(state).guess;
  if (guess === "year") return ladderYearPoints(lock.year!, answer);
  const mark = own(m.marks, id)!;
  const points = ladderPoints(lock.step, mark.titleOK, mark.artistOK);
  return guess === "both" ? points + ladderYearBonus(lock.year!, answer) : points;
}
function resetCard(m: LadderState): void {
  m.step = -1;
  m.locks = {};
  m.marks = {};
}

export const ladder: ModeRules = {
  players: [1, 8],
  start: "awaitingDraw",
  hasActive: false,
  suddenDeath: { kind: "firstToName", count: () => 1 },
  init: (state): LadderState => ({
    step: -1,
    locks: {},
    marks: {},
    usedMs: perPlayer(state, 0),
    exactYears: perPlayer(state, 0),
  }),
  act(state, action) {
    const m = of(state);
    switch (action.type) {
      case "draw":
        drawCard(state, action.card);
        resetCard(m);
        return;
      case "step":
        requirePhase(state, "open");
        // The current step again (a replay), or the next one up to the last.
        if (!Number.isInteger(action.index)) fail("A step index is an integer.");
        if (
          !(m.step >= 0 && action.index === m.step) &&
          !(action.index === m.step + 1 && action.index <= last(state))
        )
          fail(`Step ${action.index} can't follow step ${m.step}.`);
        m.step = action.index;
        return;
      case "lock":
        requirePhase(state, "open");
        if (m.step < 0) fail("Locks follow the first step.");
        once(m.locks, action.playerId);
        if (options(state).guess === "name") {
          if (action.year !== undefined) fail("Name mode takes no year.");
        } else if (action.year === undefined) fail("This mode needs a year.");
        else checkYear(action.year);
        m.locks[action.playerId] = {
          step: m.step,
          ...(action.year !== undefined && { year: action.year }),
        };
        return;
      case "mark":
        requirePhase(state, "open");
        if (!marked(state)) fail("Year mode has no marks.");
        if (!has(m.locks, action.playerId)) fail("Only locked players are marked.");
        once(m.marks, action.playerId);
        checkMarks(action.titleOK, action.artistOK);
        m.marks[action.playerId] = {
          titleOK: action.titleOK,
          artistOK: action.artistOK,
        };
        return;
    }
    unsupported(state, action);
  },
  canReveal(state) {
    const m = of(state);
    const locked = Object.keys(m.locks);
    return (
      m.step >= 0 &&
      (locked.length === state.players.length || m.step === last(state)) &&
      (!marked(state) || locked.every((id) => has(m.marks, id)))
    );
  },
  pending(state) {
    const m = of(state);
    return playerIds(state).filter((id) =>
      has(m.locks, id)
        ? marked(state) && !has(m.marks, id)
        : m.step !== last(state),
    );
  },
  reveal(state) {
    const m = of(state);
    const steps = options(state).steps;
    for (const id of playerIds(state)) {
      state.points[id] += cardPoints(state, id);
      const lock = own(m.locks, id);
      m.usedMs[id] += steps[lock ? lock.step : last(state)];
      if (lock?.year !== undefined && lock.year === state.card!.year)
        m.exactYears[id]++;
    }
    resetCard(m);
  },
  discard: (state) => resetCard(of(state)),
  ended: (state) => state.round >= options(state).rounds,
  rank: (state, id, score) => [score, -of(state).usedMs[id], of(state).exactYears[id]],
  extras: (state) => ({
    usedMs: of(state).usedMs,
    exactYears: of(state).exactYears,
    step: of(state).step,
  }),
  wagerers: playerIds,
  right: (state, id) => cardPoints(state, id) > 0,
};
