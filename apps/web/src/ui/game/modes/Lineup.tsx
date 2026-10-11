import { useState } from "react";
import type { Deck } from "../../../core/deck";
import { currentCards, pendingInputs } from "../../../core/game/engine";
import type { CardRef, Session } from "../../../core/session";
import { exactClips } from "../../../playback/player";
import { cardTitle, deltas, signed, type RevealInfo } from "../history";
import { clipPlaying, clipStartFor, useCardPlayer, type PlaybackProps } from "../playback";
import { BackupPicker, ClipStatus } from "../Stage";
import type { GameController } from "../useGame";
import { EntryForm, LockedEntry, send } from "./LockedEntry";
import { YearChip } from "./TimelineStrip";
import type { ModeInputProps, ModeUI } from "./types";

const LETTERS = ["A", "B", "C", "D", "E"];
// Lineup's clip length; sudden death in other modes plays 10 s clips.
const SUDDEN_DEATH_CLIP_MS = 10_000;

// Without exact clips the lineup is played by name: tiles show titles, not Play buttons.
export const lineupByName = (playback: PlaybackProps): boolean =>
  !(playback.hub.player && playback.hubState.tier && exactClips(playback.hubState.tier));
const letterOf = (cards: readonly CardRef[], id: string): string =>
  LETTERS[cards.findIndex((card) => card.cardId === id)] ?? "?";
// "B, A, D, C" for an order of the set's card IDs.
export const orderText = (order: readonly string[], cards: readonly CardRef[]): string =>
  order.map((id) => letterOf(cards, id)).join(", ");

// The lineup's tiles A–E, each with its own Play and playing state, or titles by name.
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
  const byName = lineupByName(playback);
  const { play, stop, playingKey, status, error } = useCardPlayer(playback, controller);
  const length =
    session.mode === "lineup" ? (session.options.clipMs as number | undefined) ?? 10_000 : SUDDEN_DEATH_CLIP_MS;
  const playing = clipPlaying(playback.clipState);
  const [revision, setRevision] = useState(0);
  return (
    <div className="lineup-stage">
      <ul className="lineup-tiles" aria-label="Lineup">
        {cards.map((ref, index) => {
          const card = deck.cards.find((item) => item.id === ref.cardId);
          const letter = LETTERS[index];
          const now = playing && playingKey === ref.cardId;
          return (
            <li key={ref.cardId} className={now ? "lineup-tile playing" : "lineup-tile"}>
              <span className="tile-letter">{letter}</span>
              {byName ? (
                <span className="tile-name">
                  <strong>{card ? card.title : `Card ${ref.cardId}`}</strong>
                  <span>{card?.artist}</span>
                </span>
              ) : card ? (
                <button
                  className={now ? "" : "primary"}
                  onClick={() => {
                    if (now) return stop();
                    setRevision((value) => value + 1);
                    void play(card, clipStartFor(card, deck, 0), length);
                  }}
                >
                  {now ? `Stop ${letter}` : `Play ${letter}`}
                </button>
              ) : (
                <span className="muted">Not in the open deck</span>
              )}
              {now ? <span className="tile-state">Playing</span> : null}
            </li>
          );
        })}
      </ul>
      {byName ? <p className="muted">Lineup by name: read the titles out, then order them by year.</p> : null}
      <BackupPicker
        cards={cards}
        deck={deck}
        provider={playback.hub.player?.provider}
        collapsed={!byName}
        previewKey={revision}
      />
      <ClipStatus playback={playback} status={status} error={error} />
    </div>
  );
}

// One player's order: Move up / Move down, then Lock in.
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
  const [order, setOrder] = useState(() => cards.map((card) => card.cardId));
  function move(index: number, by: number) {
    setOrder((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });
  }
  return (
    <EntryForm heading={heading} onLock={() => onLock(order)}>
      <p className="muted">Earliest first.</p>
      <ol className="order-list" aria-label={`${heading}, earliest first`}>
        {order.map((id, index) => {
          const letter = letterOf(cards, id);
          return (
            <li key={id} className="order-item">
              <span className="order-position">{index + 1}.</span>
              <span className="tile-letter">{letter}</span>
              {byName ? <span className="order-name">{cardTitle(deck, id).title}</span> : null}
              <button type="button" disabled={index === 0} onClick={() => move(index, -1)}>
                Move {letter} up
              </button>
              <button type="button" disabled={index === order.length - 1} onClick={() => move(index, 1)}>
                Move {letter} down
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
          byName={lineupByName(playback)}
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

