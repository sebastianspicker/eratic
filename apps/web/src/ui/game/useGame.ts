import { useSyncExternalStore } from "react";
import type { Card, Deck } from "../../core/deck";
import { eraOf } from "../../core/eras";
import {
  applyAction,
  GameError,
  replay,
  startGame,
  suddenDeathCards,
  summarize,
  type GameState,
} from "../../core/game/engine";
import { compareCodePoints, dailySelection, drawOrder, pickAnchors } from "../../core/random";
import { resolveScan } from "../../core/scan";
import { imposterPairs } from "../../core/scoring";
import {
  usedCardIds,
  type CardRef,
  type DailyOptions,
  type GameAction,
  type GameMode,
  type LineupOptions,
  type RelayOptions,
  type Session,
  type SessionOptions,
  type SessionPlayer,
  type TimelineOptions,
} from "../../core/session";
import {
  clearSession,
  discardUnreadableSession,
  loadPlayPrefs,
  PLAY_PREFS_KEY,
  loadSession,
  loadSessionDeck,
  persistSession,
  persistSessionDeck,
  readUnreadableSession,
  recordDaily,
  savePlayPrefs,
  UnreadableSessionSlotError,
} from "../../sessions";
import { cardsNeeded, isEasy, MODE_INFO } from "./modes";

// The host's game: one session, its engine state, and persistence after every
// action. Rules stay in the core; this only builds actions and stores them.
export type ActionInput = GameAction extends infer A
  ? A extends GameAction
    ? Omit<A, "at">
    : never
  : never;
export interface Summary {
  phase: GameState["phase"];
  round: number;
  scores: Record<string, number>;
  standings: string[][];
  active?: string;
  suddenDeath?: { kind: string; players: string[] };
  chips?: Record<string, number>;
  exact?: Record<string, number>;
  distance?: Record<string, number>;
  rightEras?: Record<string, number>;
  streaks?: Record<string, number>;
  eliminated?: string[];
  reference?: string;
  maxScore?: number;
  eras?: string[];
  shareText?: string;
  timelines?: Record<string, string[]>;
  timeline?: string[];
  tokens?: Record<string, number>;
  wrong?: Record<string, number>;
  lives?: number;
  teamScore?: number;
  outcome?: "playing" | "won" | "lost" | "ended";
  usedMs?: Record<string, number>;
  exactYears?: Record<string, number>;
  step?: number;
  perfect?: Record<string, number>;
  bonuses?: Record<string, number>;
}
export type CardSource = "scan" | "draw";
export interface StartSetup {
  mode: GameMode;
  options: SessionOptions;
  players: SessionPlayer[];
  source: CardSource;
  easyOnly: boolean;
}
export interface GameView {
  session?: Session;
  state?: GameState;
  summary?: Summary;
  // An unfinished saved game waiting for Resume.
  saved?: Session;
  unreadable: boolean;
  notice: string;
  storageNotice: string;
  announcement: string;
  source: CardSource;
  easyOnly: boolean;
  // The deck the open game started with, kept for Resume when another deck is open.
  deckSnapshot?: Deck;
  // Counts games opened (started or resumed), so the host screen starts fresh for each.
  run: number;
}
export type ScanOutcome =
  | { kind: "drawn" }
  | { kind: "message"; text: string; audio?: { provider: "spotify" | "appleMusic"; trackId: string; url: string } };

export const cardRef = (card: Card): CardRef => ({
  cardId: card.id,
  year: card.gameYear.value,
  era: eraOf(card.gameYear.value),
});
export const summaryOf = (state: GameState): Summary => summarize(state) as unknown as Summary;
// The engine's messages for the common slips, in friendlier words; anything
// else is shown as the engine says it.
export function friendlyError(message: string, session: Session): string {
  const name = (id: string) => session.players.find((player) => player.id === id)?.name ?? id;
  let match: RegExpExecArray | null;
  if ((match = /^(.+) already gave this input\.$/u.exec(message))) return `${name(match[1])} has already answered.`;
  if ((match = /^(.+) is not the active player\.$/u.exec(message))) return `It isn't ${name(match[1])}'s turn.`;
  if ((match = /^(.+) holds no chips\.$/u.exec(message))) return `${name(match[1])} has no chips left to wager.`;
  if (message === "The reveal needs every input.") return "Some answers are still missing.";
  if (message === "A challenge needs a slot nobody chose this turn.") return "Pick a slot nobody has chosen this turn.";
  if (message === "A challenge needs a token.") return "No tokens left for a challenge.";
  return message;
}
// The pair key the engine uses: the two card IDs in code-point order.
const pairKey = (a: string, b: string): string => [a, b].sort(compareCodePoints).join("/");
// Today's date in UTC, as Daily Eratic uses it.
export const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
// Comma-separated Eratic card hosts of this build; none until a card domain is chosen.
export function cardHosts(): string[] {
  return (import.meta.env.VITE_ERATIC_CARD_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "");
}
const DRAWS = new Set<GameAction["type"]>(["draw", "drawSet", "drawPair", "sdDraw"]);
const defaultRandom = (): number => crypto.getRandomValues(new Uint32Array(1))[0];
function defaultStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export class GameController {
  private listeners = new Set<() => void>();
  private view: GameView;
  private last?: StartSetup;

  constructor(
    private storage: Storage | undefined = defaultStorage(),
    private now: () => number = () => Date.now(),
    private random: () => number = defaultRandom,
  ) {
    const loaded = loadSession(storage);
    let saved: Session | undefined;
    if (loaded.session)
      try {
        if (replay(loaded.session).phase !== "finished") saved = loaded.session;
      } catch {
        // parseSession already replayed it; unreachable in practice
      }
    this.view = {
      saved,
      unreadable: loaded.unreadable,
      notice: loaded.notice,
      storageNotice: "",
      announcement: "",
      source: "draw",
      easyOnly: false,
      run: 0,
    };
  }

  getSnapshot = (): GameView => this.view;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private set(patch: Partial<GameView>) {
    this.view = { ...this.view, ...patch };
    for (const listener of [...this.listeners]) listener();
  }
  setNotice(notice: string) {
    this.set({ notice });
  }

  private persist(session: Session): string {
    try {
      persistSession(session, this.storage);
      return "";
    } catch (failure) {
      return failure instanceof UnreadableSessionSlotError
        ? failure.message
        : "Browser storage is unavailable. This game won't survive a reload.";
    }
  }
  private pool(deck: Deck, easyOnly = this.view.easyOnly): Card[] {
    return easyOnly ? deck.cards.filter(isEasy) : deck.cards;
  }

  start(chosen: StartSetup, deck: Deck): boolean {
    // Daily Eratic picks the day's cards from the whole deck, so everyone with the deck gets the same round.
    const setup = chosen.mode === "daily" ? { ...chosen, easyOnly: false } : chosen;
    const now = this.now();
    const createdAt = `${new Date(Math.floor(now / 1000) * 1000).toISOString().slice(0, 19)}Z`;
    const seed = this.random() >>> 0;
    const pool = this.pool(deck, setup.easyOnly);
    const options =
      setup.mode === "daily"
        ? {
            date: utcDate(now),
            cards: dailySelection(
              deck.cards.map((card) => card.id),
              utcDate(now),
              deck.id,
            ),
          }
        : setup.options;
    let session: Session = {
      format: "eratic-session",
      sessionVersion: 1,
      id: `s-${now.toString(36)}`,
      createdAt,
      deckId: deck.id,
      deckTitle: deck.title,
      mode: setup.mode,
      options,
      seed,
      players: setup.players,
      actions: [],
    };
    let state: GameState;
    try {
      state = startGame(session);
    } catch (failure) {
      this.set({ notice: (failure as Error).message });
      return false;
    }
    // Checked before anything is saved, so a too-small deck never leaves a half-started game.
    const need = cardsNeeded(setup.mode, setup.options, setup.players.length);
    if (pool.length < need) {
      this.set({
        notice: setup.easyOnly
          ? `Not enough easy cards: ${MODE_INFO[setup.mode].name} with these settings needs ${need}.`
          : `Deck too small: ${MODE_INFO[setup.mode].name} with these settings needs ${need} cards.`,
      });
      return false;
    }
    if (setup.mode === "imposter" && imposterPairs(pool, seed).length === 0) {
      this.set({ notice: "These cards have no linked recordings to pair." });
      return false;
    }
    // Setup actions: Timeline and Relay anchors, the Higher or Lower reference.
    const setupActions: ActionInput[] = [];
    const lines: string[] = [];
    const byId = new Map(pool.map((card) => [card.id, card]));
    try {
      if (setup.mode === "timeline" || setup.mode === "relay") {
        const opts = state.options as TimelineOptions | RelayOptions;
        const personal = setup.mode === "timeline" && (opts as TimelineOptions).ownership === "personal";
        const ids = pickAnchors(
          pool.map((card) => ({ id: card.id, year: card.gameYear.value })),
          opts.anchor,
          seed,
          personal ? setup.players.length : 1,
          opts.anchorYear,
        );
        ids.forEach((id, index) => {
          const card = byId.get(id)!;
          const player = setup.players[index];
          setupActions.push(
            personal
              ? { type: "anchor", playerId: player.id, card: cardRef(card) }
              : { type: "anchor", card: cardRef(card) },
          );
          lines.push(
            personal
              ? `Give ${player.name} ${card.title} (${card.gameYear.value}) as their first card.`
              : `Start the line with ${card.title} (${card.gameYear.value}).`,
          );
        });
      }
      if (setup.mode === "higherLower") {
        const id = drawOrder(
          pool.map((card) => card.id),
          seed,
        )[0];
        if (!id) throw new Error("The deck has no cards to play.");
        setupActions.push({ type: "reference", card: cardRef(byId.get(id)!) });
      }
      setupActions.forEach((input, index) => {
        const action = { ...input, at: 0 } as GameAction;
        state = applyAction(state, action, index);
        session = { ...session, actions: [...session.actions, action] };
      });
    } catch (failure) {
      this.set({ notice: (failure as Error).message });
      return false;
    }
    this.last = setup;
    let storageNotice = this.persist(session);
    if (!storageNotice) {
      if (!savePlayPrefs(session.id, { easyOnly: setup.easyOnly, source: setup.source }, this.storage) && setup.easyOnly)
        storageNotice = "Browser storage refused the game's settings, so Easy cards only won't survive a reload.";
      persistSessionDeck(deck, this.storage);
    }
    this.set({
      session,
      state,
      summary: summaryOf(state),
      saved: undefined,
      notice: "",
      storageNotice,
      announcement: lines.join(" "),
      source: setup.source,
      easyOnly: setup.easyOnly,
      deckSnapshot: deck,
      run: this.view.run + 1,
    });
    return true;
  }
  playAgain(deck: Deck): boolean {
    const session = this.view.session;
    if (!session) return false;
    return this.start(
      this.last ?? {
        mode: session.mode,
        options: session.options,
        players: session.players,
        source: this.view.source,
        easyOnly: this.view.easyOnly,
      },
      deck,
    );
  }
  resume() {
    const saved = this.view.saved;
    if (!saved) return;
    const state = replay(saved);
    this.last = undefined;
    const prefs = loadPlayPrefs(saved.id, this.storage);
    const snapshot = loadSessionDeck(this.storage);
    this.set({
      session: saved,
      state,
      summary: summaryOf(state),
      saved: undefined,
      notice: "",
      announcement: "",
      source: prefs?.source ?? "draw",
      easyOnly: prefs?.easyOnly ?? false,
      deckSnapshot: snapshot?.id === saved.deckId ? snapshot : undefined,
      run: this.view.run + 1,
    });
  }
  // The banner stays when the saved game could not actually be removed.
  discardSaved() {
    if (!clearSession(this.storage)) {
      this.set({ notice: "Couldn't discard the saved game: browser storage didn't allow it." });
      return;
    }
    try {
      this.storage?.removeItem(PLAY_PREFS_KEY);
    } catch {
      // storage unavailable
    }
    this.set({ saved: undefined, notice: "" });
  }
  // Leaves the host screen; an unfinished game stays saved for Resume.
  close() {
    const { session, state } = this.view;
    this.set({
      session: undefined,
      state: undefined,
      summary: undefined,
      saved: session && state && state.phase !== "finished" ? session : undefined,
      notice: "",
      announcement: "",
      deckSnapshot: undefined,
    });
  }
  readUnreadable(): string | null {
    return readUnreadableSession(this.storage);
  }
  discardUnreadable() {
    try {
      discardUnreadableSession(this.storage);
      this.set({ unreadable: false, notice: "" });
    } catch {
      this.set({ notice: "Browser storage is unavailable. Could not discard the saved game." });
    }
  }

  // Stamps at = max(previous at, ms since the session was created) and applies
  // the action; a rejected action keeps the old state and shows the reason.
  dispatch(input: ActionInput): boolean {
    const { session, state } = this.view;
    if (!session || !state) return false;
    const previous = session.actions.at(-1)?.at ?? 0;
    const at = Math.max(previous, this.now() - Date.parse(session.createdAt));
    const action = { ...input, at } as GameAction;
    let next: GameState;
    try {
      next = applyAction(state, action, session.actions.length);
    } catch (failure) {
      if (!(failure instanceof GameError)) throw failure;
      this.set({ notice: friendlyError(failure.message, session) });
      return false;
    }
    const updated = { ...session, actions: [...session.actions, action] };
    const summary = summaryOf(next);
    if (session.mode === "daily" && state.phase !== "finished" && next.phase === "finished") {
      const options = next.options as DailyOptions;
      recordDaily(
        options.date,
        summary.scores[next.players[0].id],
        session.deckId,
        summary.shareText,
        this.storage,
      );
    }
    this.set({
      session: updated,
      state: next,
      summary,
      notice: "",
      storageNotice: this.persist(updated),
      // The anchor announcement is for the start; it goes once the first card is in play.
      ...(DRAWS.has(action.type) && { announcement: "" }),
    });
    return true;
  }
  // The state these inputs would lead to, without recording them; undefined if
  // the engine would reject any of them.
  project(inputs: readonly ActionInput[]): GameState | undefined {
    const { session, state } = this.view;
    if (!session || !state) return undefined;
    let next = state;
    const at = session.actions.at(-1)?.at ?? 0;
    try {
      inputs.forEach((input, index) => {
        next = applyAction(next, { ...input, at } as GameAction, session.actions.length + index);
      });
    } catch (failure) {
      if (failure instanceof GameError) return undefined;
      throw failure;
    }
    return next;
  }

  private deckMismatch(deck: Deck): string | undefined {
    const session = this.view.session;
    return session && session.deckId !== deck.id
      ? `This game uses deck ${session.deckId}. Open that deck to play its cards.`
      : undefined;
  }
  // The first card of drawOrder not yet used in the session.
  nextDeckCards(deck: Deck, count = 1): Card[] {
    const { session, state } = this.view;
    if (!session || !state || this.deckMismatch(deck)) return [];
    const used = new Set(usedCardIds(state));
    const pool = this.pool(deck);
    const byId = new Map(pool.map((card) => [card.id, card]));
    return drawOrder(
      pool.map((card) => card.id),
      session.seed,
    )
      .filter((id) => !used.has(id))
      .slice(0, count)
      .map((id) => byId.get(id)!);
  }
  // The deck the host plays from: the open deck, or the game's own snapshot when
  // another deck is open.
  deckFor(open: Deck): Deck {
    const { session, deckSnapshot } = this.view;
    return session && open.id !== session.deckId && deckSnapshot?.id === session.deckId ? deckSnapshot : open;
  }
  // Original or Imposter: the next pair of imposterPairs not yet played, in either order.
  private nextPair(deck: Deck): { a: Card; b: Card; original: "a" | "b" } | undefined {
    const session = this.view.session;
    if (!session) return undefined;
    const played = new Set(
      session.actions.flatMap((action) =>
        action.type === "drawPair" ? [pairKey(action.a.cardId, action.b.cardId)] : [],
      ),
    );
    const byId = new Map(deck.cards.map((card) => [card.id, card]));
    const pair = imposterPairs(this.pool(deck), session.seed).find((item) => !played.has(pairKey(item.a, item.b)));
    return pair && { a: byId.get(pair.a)!, b: byId.get(pair.b)!, original: pair.original === pair.a ? "a" : "b" };
  }
  // Whether the next card (lineup, pair, sudden-death set) can still be drawn.
  canDraw(deck: Deck): boolean {
    const { session, state } = this.view;
    if (!session || !state) return false;
    // Round i can only draw the day's card i; after a skip it is used and the round can only end.
    if (session.mode === "daily") {
      const id = (state.options as DailyOptions).cards[state.round];
      return id !== undefined && !usedCardIds(state).includes(id);
    }
    if (state.phase === "awaitingDraw" && session.mode === "imposter") return this.nextPair(deck) !== undefined;
    const count =
      state.phase === "suddenDeath"
        ? this.suddenDeathCount()
        : session.mode === "lineup"
          ? (state.options as LineupOptions).k
          : 1;
    return this.nextDeckCards(deck, count).length >= count;
  }
  suddenDeathCount(): number {
    const state = this.view.state;
    return state ? suddenDeathCards(state) : 0;
  }
  // Draws the next card from the deck (or the day's card in Daily Eratic).
  draw(deck: Deck): boolean {
    const { session, state } = this.view;
    if (!session || !state) return false;
    const mismatch = this.deckMismatch(deck);
    if (mismatch) {
      this.set({ notice: mismatch });
      return false;
    }
    if (state.phase === "suddenDeath") {
      const count = this.suddenDeathCount();
      const cards = this.nextDeckCards(deck, count);
      if (cards.length < count) {
        this.set({ notice: "Not enough cards left for sudden death. End the game to keep the tie." });
        return false;
      }
      return this.dispatch({ type: "sdDraw", cards: cards.map(cardRef) });
    }
    if (session.mode === "lineup") {
      const k = (state.options as LineupOptions).k;
      const cards = this.nextDeckCards(deck, k);
      if (cards.length < k) {
        this.set({ notice: "Not enough cards left for another lineup. End the game to see the results." });
        return false;
      }
      return this.dispatch({ type: "drawSet", cards: cards.map(cardRef) });
    }
    if (session.mode === "imposter") {
      const pair = this.nextPair(deck);
      if (!pair) {
        this.set({ notice: "No pairs left. End the game to see the results." });
        return false;
      }
      return this.dispatch({ type: "drawPair", a: cardRef(pair.a), b: cardRef(pair.b), original: pair.original });
    }
    let card: Card | undefined;
    if (session.mode === "daily") {
      const id = (state.options as DailyOptions).cards[state.round];
      card = deck.cards.find((item) => item.id === id);
    } else card = this.nextDeckCards(deck)[0];
    if (!card) {
      this.set({ notice: "No cards left. End the game to see the results." });
      return false;
    }
    return this.dispatch({ type: "draw", card: cardRef(card) });
  }
  // A scanned payload selects a card (game-rules.md section 8.2); it never plays anything.
  scan(payload: string, deck: Deck, hosts: readonly string[] = cardHosts()): ScanOutcome {
    const { state } = this.view;
    if (!state) return { kind: "message", text: "Start a game first." };
    const mismatch = this.deckMismatch(deck);
    if (mismatch) return { kind: "message", text: mismatch };
    if (state.phase !== "awaitingDraw" && state.phase !== "suddenDeath")
      return { kind: "message", text: "Finish this card first." };
    const result = resolveScan(payload, deck, hosts);
    switch (result.kind) {
      case "card": {
        if (usedCardIds(state).includes(result.cardId))
          return { kind: "message", text: "Already played; scan another card." };
        const card = deck.cards.find((item) => item.id === result.cardId)!;
        if (state.phase === "suddenDeath") {
          if (this.suddenDeathCount() !== 1)
            return { kind: "message", text: "This sudden death draws its cards from the deck." };
          return this.dispatch({ type: "sdDraw", cards: [cardRef(card)] })
            ? { kind: "drawn" }
            : { kind: "message", text: this.view.notice };
        }
        return this.dispatch({ type: "draw", card: cardRef(card) })
          ? { kind: "drawn" }
          : { kind: "message", text: this.view.notice };
      }
      case "otherDeck":
        return {
          kind: "message",
          text: `This card belongs to deck ${result.deckId}. Import that deck first.`,
        };
      case "unknownCard":
        return { kind: "message", text: `This deck has no card ${result.cardId}.` };
      case "unmatchedProvider":
        return {
          kind: "message",
          text: "This song isn't in the deck, so it can't be scored.",
          audio: { provider: result.provider, trackId: result.trackId, url: payload },
        };
      case "unmatchedOfficial":
        return {
          kind: "message",
          text: "This official card isn't mapped to a card in this deck.",
        };
      default:
        return { kind: "message", text: "This QR code isn't an Eratic card or a song link." };
    }
  }
}

export function useGame(controller: GameController): GameView {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot);
}
