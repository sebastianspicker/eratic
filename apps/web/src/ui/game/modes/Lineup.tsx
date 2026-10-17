import { useEffect, useRef, useState } from "react";
import type { Deck } from "../../../core/deck";
import { currentCards, pendingInputs } from "../../../core/game/engine";
import type { CardRef, Session } from "../../../core/session";
import { exactClips } from "../../../playback/player";
import { cardTitle, deltas, signed, type RevealInfo } from "../history";
import { clipPlaying, clipStartFor, useCardPlayer, type PlaybackProps } from "../playback";
import { previewUrl, useTileSnippets } from "../SnippetPreview";
import { BackupPicker, ClipStatus } from "../Stage";
import type { GameController } from "../useGame";
import { EntryForm, LockedEntry, send } from "./LockedEntry";
import { YearChip } from "./TimelineStrip";
import type { ModeInputProps, ModeUI } from "./types";

const LETTERS = ["A", "B", "C", "D", "E"];
// Lineup's clip length; sudden death in other modes plays 10 s clips.
const SUDDEN_DEATH_CLIP_MS = 10_000;
// Snippets play from the start of a provider preview, which holds about 30 s.
const MAX_SNIPPET_MS = 30_000;

// How the lineup is played: exact clips, preview snippets (without exact clips, when
// some tile has a Spotify/Apple Music preview), else by name: tiles show titles.
export type LineupMode = "exact" | "snippets" | "byName";
const exactTier = (playback: PlaybackProps): boolean =>
  Boolean(playback.hub.player && playback.hubState.tier && exactClips(playback.hubState.tier));
export function lineupMode(cards: readonly CardRef[], deck: Deck, playback: PlaybackProps): LineupMode {
  if (exactTier(playback)) return "exact";
  // Provider-agnostic, like modeAvailability and the native SongBackup.hasSnippet.
  return cards.some((ref) => {
    const card = deck.cards.find((item) => item.id === ref.cardId);
    return card !== undefined && previewUrl(card, undefined) !== undefined;
  })
    ? "snippets"
    : "byName";
}
// Without cards it answers for the tier alone: no exact clips means by name.
export const lineupByName = (playback: PlaybackProps, cards?: readonly CardRef[], deck?: Deck): boolean =>
  cards && deck ? lineupMode(cards, deck, playback) === "byName" : !exactTier(playback);
// The mode's title on Play home and the host bar: "Lineup by name" only when no card
// in the deck can play a snippet (and clips aren't exact).
export const lineupDeckByName = (deck: Deck, playback: PlaybackProps): boolean =>
  !exactTier(playback) && !deck.cards.some((card) => previewUrl(card, undefined) !== undefined);
const letterOf = (cards: readonly CardRef[], id: string): string =>
  LETTERS[cards.findIndex((card) => card.cardId === id)] ?? "?";
// "B, A, D, C" for an order of the set's card IDs.
export const orderText = (order: readonly string[], cards: readonly CardRef[]): string =>
  order.map((id) => letterOf(cards, id)).join(", ");

// The lineup's tiles A–E, each with its own Play and playing state: exact clips,
// preview snippets, or titles by name (also for a snippet tile without a preview).
export function LineupTiles({
  cards,
  deck,
  session,
  playback,
  controller,
}: {
  cards: readonly CardRef[];
  deck: Deck;
  session: Session;
  playback: PlaybackProps;
  controller: GameController;
}) {
  const mode = lineupMode(cards, deck, playback);
  const { play, stop, playingKey, preparingKey, status, error } = useCardPlayer(playback, controller);
  const length =
    session.mode === "lineup" ? (session.options.clipMs as number | undefined) ?? 10_000 : SUDDEN_DEATH_CLIP_MS;
  const playing = clipPlaying(playback.clipState);
  const [revision, setRevision] = useState(0);
  const provider = playback.hub.player?.provider;
  const open = cards.map((ref) => deck.cards.find((item) => item.id === ref.cardId));
  // A snippet stops the backup's own preview, like an exact clip.
  const snippets = useTileSnippets(
    mode === "snippets"
      ? cards.map((ref, index) => ({ id: ref.cardId, url: open[index] && previewUrl(open[index], undefined) }))
      : [],
    Math.min(length, MAX_SNIPPET_MS),
    () => setRevision((value) => value + 1),
  );
  const byName = mode === "byName" || (mode === "snippets" && !snippets.available);
  const loadedLetter = LETTERS[cards.findIndex((ref) => ref.cardId === snippets.loaded)];
  return (
    <div className="lineup-stage">
      <ul className="lineup-tiles" aria-label="Lineup">
        {cards.map((ref, index) => {
          const card = open[index];
          const letter = LETTERS[index];
          const snippet = mode === "snippets" ? snippets.tile(ref.cardId) : undefined;
          const now = snippet
            ? snippet === "starting" || snippet === "playing"
            : playing && playingKey === ref.cardId;
          const preparing = preparingKey === ref.cardId;
          return (
            <li key={ref.cardId} className={now ? "lineup-tile playing" : "lineup-tile"}>
              <span className="tile-letter">{letter}</span>
              {mode === "byName" || snippet === "title" ? (
                <span className="tile-name">
                  <strong>{card ? card.title : `Card ${ref.cardId}`}</strong>
                  <span>{card?.artist}</span>
                </span>
              ) : snippet ? (
                <button
                  className={now ? "" : "primary"}
                  aria-disabled={snippet === "loading" ? "true" : undefined}
                  onClick={() => {
                    if (snippet !== "loading") snippets.press(ref.cardId);
                  }}
                >
                  {now ? `Stop ${letter}` : snippet === "loading" ? `Loading ${letter}…` : `Play ${letter}`}
                </button>
              ) : card ? (
                <button
                  className={now ? "" : "primary"}
                  aria-disabled={preparing ? "true" : undefined}
                  onClick={() => {
                    if (preparing) return;
                    if (now) return stop();
                    setRevision((value) => value + 1);
                    void play(card, clipStartFor(card, deck, 0), length);
                  }}
                >
                  {preparing ? "Preparing…" : now ? `Stop ${letter}` : `Play ${letter}`}
                </button>
              ) : (
                <span className="muted">Not in the open deck</span>
              )}
              {snippet === "starting" ? (
                <span className="tile-state">Starting…</span>
              ) : now ? (
                <span className="tile-state">Playing</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {byName ? (
        <p className="muted">Lineup by name: read the titles out, then order them by year.</p>
      ) : mode === "snippets" ? (
        <p className="muted">
          Snippets play from each song's preview and stop by themselves. A tile without a preview shows its title.
        </p>
      ) : null}
      {mode === "snippets" ? snippets.frame : null}
      {mode === "snippets" && snippets.status ? (
        <p className="muted" role="status">
          {loadedLetter}: {snippets.status}
        </p>
      ) : null}
      <BackupPicker
        cards={cards}
        deck={deck}
        provider={provider}
        collapsed={!byName}
        previewKey={revision}
      />
      <ClipStatus playback={playback} status={status} error={error} />
    </div>
  );
}

// One player's order: tap the songs earliest first (Move up / Move down and
// Remove fix mistakes), then Lock in once every song is placed.
export function OrderEntry({
  heading,
  cards,
  deck,
  byName,
  onLock,
}: {
  heading: string;
  cards: readonly CardRef[];
  deck: Deck;
  byName: boolean;
  onLock: (order: string[]) => string;
}) {
  const [order, setOrder] = useState<string[]>([]);
  const pool = cards.filter((card) => !order.includes(card.cardId));
  const listRef = useRef<HTMLOListElement>(null);
  const poolRef = useRef<HTMLDivElement>(null);
  // Where focus goes once the next order renders: the pressed button disables or unmounts.
  const refocus = useRef<{ id: string; control: "up" | "down" | "remove" } | undefined>(undefined);
  useEffect(() => {
    const wanted = refocus.current;
    refocus.current = undefined;
    if (!wanted) return;
    const find = (id: string, control: string) =>
      [...(listRef.current?.querySelectorAll<HTMLButtonElement>("button[data-order-control]") ?? [])].find(
        (item) => item.dataset.orderId === id && item.dataset.orderControl === control && !item.disabled,
      );
    const target =
      wanted.control === "remove"
        ? find(wanted.id, "remove")
        : (find(wanted.id, wanted.control) ?? find(wanted.id, wanted.control === "up" ? "down" : "up"));
    (target ?? poolRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, [order]);
  function move(index: number, by: number) {
    refocus.current = { id: order[index], control: by < 0 ? "up" : "down" };
    setOrder((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  }
  // Focus passes to the next item's Remove, or (as the removed song joins the pool) the pool.
  function remove(index: number) {
    const next = order[index + 1];
    refocus.current = { id: next ?? "", control: "remove" };
    setOrder((current) => current.filter((_, at) => at !== index));
  }
  return (
    <EntryForm
      heading={heading}
      onLock={() => (order.length < cards.length ? "Place every song first." : onLock(order))}
    >
      <p className="muted">Earliest first.</p>
      <div className="action-row" role="group" aria-label={`${heading}, songs left to place`} ref={poolRef}>
        {pool.map((card) => (
          <button
            key={card.cardId}
            type="button"
            onClick={() => setOrder((current) => [...current, card.cardId])}
          >
            {letterOf(cards, card.cardId)}
            {byName ? ` ${cardTitle(deck, card.cardId).title}` : ""}
          </button>
        ))}
        {order.length > 0 ? (
          <button type="button" className="quiet" onClick={() => setOrder([])}>
            Clear
          </button>
        ) : null}
      </div>
      <ol className="order-list" aria-label={`${heading}, earliest first`} ref={listRef}>
        {order.map((id, index) => {
          const letter = letterOf(cards, id);
          return (
            <li key={id} className="order-item">
              <span className="order-position">{index + 1}.</span>
              <span className="tile-letter">{letter}</span>
              {byName ? <span className="order-name">{cardTitle(deck, id).title}</span> : null}
              <button
                type="button"
                data-order-id={id}
                data-order-control="up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                Move {letter} up
              </button>
              <button
                type="button"
                data-order-id={id}
                data-order-control="down"
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
              >
                Move {letter} down
              </button>
              <button
                type="button"
                data-order-id={id}
                data-order-control="remove"
                onClick={() => remove(index)}
              >
                Remove {letter}
              </button>
            </li>
          );
        })}
      </ol>
    </EntryForm>
  );
}

// The right order as era chips (by year; equal years keep the set's order).
export function RightOrder({ cards, deck }: { cards: readonly CardRef[]; deck: Deck }) {
  const sorted = cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => a.card.year - b.card.year || a.index - b.index);
  return (
    <section className="right-order" aria-label="The right order">
      <h2 tabIndex={-1}>The right order</h2>
      <ol className="tl-row">
        {sorted.map(({ card, index }) => (
          <li key={card.cardId} className="tl-card">
            <YearChip card={card} deck={deck} letter={LETTERS[index]} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function LineupStage({ state, deck, session, playback, controller }: ModeInputProps) {
  return <LineupTiles cards={currentCards(state)} deck={deck} session={session} playback={playback} controller={controller} />;
}

function LineupInput({ controller, state, deck, playback }: ModeInputProps) {
  const cards = currentCards(state);
  return (
    <LockedEntry players={state.players} pending={pendingInputs(state)}>
      {(player) => (
        <OrderEntry
          heading={`${player.name}'s order`}
          cards={cards}
          deck={deck}
          byName={lineupByName(playback, cards, deck)}
          onLock={(order) => send(controller, { type: "order", playerId: player.id, order })}
        />
      )}
    </LockedEntry>
  );
}

const perfectGain = (info: RevealInfo, id: string): boolean =>
  (info.after.perfect?.[id] ?? 0) > (info.before.perfect?.[id] ?? 0);

export const lineupUI: ModeUI = {
  Input: LineupInput,
  Stage: LineupStage,
  heroCard: () => undefined,
  resultLines: (info) =>
    info.inputs.flatMap((action) =>
      action.type === "order"
        ? [
            {
              playerId: action.playerId,
              text: `${signed(deltas(info, action.playerId).points)}${perfectGain(info, action.playerId) ? ", perfect" : ""} (ordered ${orderText(action.order, info.cards)})`,
            },
          ]
        : [],
    ),
  RevealExtra: ({ info, deck }) => <RightOrder cards={info.cards} deck={deck} />,
  tieBreaks: (summary, id) => [`${summary.perfect?.[id] ?? 0} perfect lines`],
};

