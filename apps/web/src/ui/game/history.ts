import type { Deck } from "../../core/deck";
import { currentCards, replay } from "../../core/game/engine";
import type { CardRef, GameAction, Session } from "../../core/session";
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
// The latest reveal, when it is the last action.
export function lastReveal(session: Session, after: Summary): RevealInfo | undefined {
  const actions = session.actions;
  if (actions.at(-1)?.type !== "reveal") return undefined;
  const previous = replay({ ...session, actions: actions.slice(0, -1) });
  return {
    cards: currentCards(previous),
    before: summaryOf(previous),
    after,
    inputs: inputsSinceDraw(actions.slice(0, -1)),
    suddenDeath: previous.phase === "suddenDeathOpen",
  };
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
