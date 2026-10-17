import type { Deck } from "../../core/deck";
import { applyAction, currentCards, replay, startGame, type GameState } from "../../core/game/engine";
import type { CardRef, GameAction, Session } from "../../core/session";
import { distance } from "../../core/scoring";
import { summaryOf, type Summary } from "./useGame";

// Reads the session's action log for display. Results come from the engine's
// summaries before and after an action, never from scoring in the UI.
const DRAWS = new Set(["draw", "sdDraw", "drawSet", "drawPair"]);

// Inputs given since the latest card entered play (clips excluded).
export function inputsSinceDraw(actions: readonly GameAction[]): GameAction[] {
  let start = actions.length;
  while (start > 0 && !DRAWS.has(actions[start - 1].type)) start--;
  return actions.slice(start).filter((action) => action.type !== "clip");
}
export function refById(session: Session, cardId: string | undefined): CardRef | undefined {
  if (cardId === undefined) return undefined;
  for (const action of session.actions) {
    const refs =
      "card" in action
        ? [action.card]
        : "cards" in action
          ? action.cards
          : action.type === "drawPair"
            ? [action.a, action.b]
            : [];
    const found = refs.find((ref) => ref.cardId === cardId);
    if (found) return found;
  }
  return undefined;
}
// Higher or Lower with everyone calling reports lives per player; Relay's summary has one number.
export function playerLives(summary: Summary): Record<string, number> | undefined {
  const lives: unknown = summary.lives;
  return typeof lives === "object" && lives !== null ? (lives as Record<string, number>) : undefined;
}
export const playerName = (session: Session, id: string): string =>
  session.players.find((player) => player.id === id)?.name ?? id;
export function cardTitle(deck: Deck, cardId: string): { title: string; artist: string } {
  const card = deck.cards.find((item) => item.id === cardId);
  return card ? { title: card.title, artist: card.artist } : { title: `Card ${cardId}`, artist: "" };
}
// "Ada and Lin", "Ada, Kai and Lin".
export function listNames(names: string[]): string {
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export interface RevealInfo {
  cards: CardRef[];
  before: Summary;
  after: Summary;
  inputs: GameAction[];
  suddenDeath: boolean;
}
// The reveal at actions[index], from the state just before it and the summary after.
function revealAt(actions: readonly GameAction[], index: number, previous: GameState, after: Summary): RevealInfo {
  return {
    cards: currentCards(previous),
    before: summaryOf(previous),
    after,
    inputs: inputsSinceDraw(actions.slice(0, index)),
    suddenDeath: previous.phase === "suddenDeathOpen",
  };
}
// The latest reveal, when it is the last action.
export function lastReveal(session: Session, after: Summary): RevealInfo | undefined {
  const actions = session.actions;
  if (actions.at(-1)?.type !== "reveal") return undefined;
  const previous = replay({ ...session, actions: actions.slice(0, -1) });
  return revealAt(actions, actions.length - 1, previous, after);
}
// Every reveal in order, by replaying the session once; index is the reveal's action.
export function reveals(session: Session): (RevealInfo & { index: number })[] {
  const result: (RevealInfo & { index: number })[] = [];
  let state = startGame(session);
  session.actions.forEach((action, index) => {
    const next = applyAction(state, action, index);
    if (action.type === "reveal") result.push({ ...revealAt(session.actions, index, state, summaryOf(next)), index });
    state = next;
  });
  return result;
}
// Score change for a player across the reveal, split into points and chips.
export function deltas(info: RevealInfo, id: string): { points: number; chips: number } {
  const chips = (info.after.chips?.[id] ?? 0) - (info.before.chips?.[id] ?? 0);
  const score = (info.after.scores[id] ?? 0) - (info.before.scores[id] ?? 0);
  return { points: score - chips, chips };
}
export const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);
export function chipsText(chips: number): string {
  if (chips === 0) return "";
  return chips > 0 ? `, won ${chips} chip${chips === 1 ? "" : "s"}` : `, lost ${-chips} chip${chips === -1 ? "" : "s"}`;
}
// Places with shared places as "=1" (section 5.5 standings groups).
export function places(standings: string[][]): { id: string; place: string }[] {
  const result: { id: string; place: string }[] = [];
  let position = 1;
  for (const group of standings) {
    for (const id of group)
      result.push({ id, place: group.length > 1 ? `=${position}` : String(position) });
    position += group.length;
  }
  return result;
}

// "exact" or "N years off": the one wording for a guess against the answer.
export const yearsOff = (n: number): string => (n === 0 ? "exact" : `${n} year${n === 1 ? "" : "s"} off`);
// How far a guessed year is from the answer, by the core's distance (Daily and sudden death have no per-player summary of it).
export const yearsOffBy = (guess: number, answer: number): string => yearsOff(distance(guess, answer));
