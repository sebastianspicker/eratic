import { useState } from "react";
import type { Deck } from "../../../core/deck";
import { currentCards, pendingInputs } from "../../../core/game/engine";
import type { CardRef, GameAction, Session } from "../../../core/session";
import { cardTitle, deltas, signed, type RevealInfo } from "../history";
import { clipLengthFor, clipPlaying, clipStartFor, useCardPlayer } from "../playback";
import { ClipStatus } from "../Stage";
import { EntryForm, LockedEntry, send } from "./LockedEntry";
import type { ModeInputProps, ModeUI } from "./types";
import { parseYear, YearField } from "./YearField";

const SIDES = ["a", "b"] as const;
type Side = (typeof SIDES)[number];

// The pair in play or just revealed: the session's latest drawPair.
function lastPair(session: Session): Extract<GameAction, { type: "drawPair" }> | undefined {
  for (let i = session.actions.length - 1; i >= 0; i--) {
    const action = session.actions[i];
    if (action.type === "drawPair") return action;
  }
  return undefined;
}

// Play A and Play B, each with its playing state.
function ImposterStage({ state, deck, session, playback, controller }: ModeInputProps) {
  const cards = currentCards(state);
  const { player, play, stop, playingKey, status, error } = useCardPlayer(playback, controller);
  const playing = clipPlaying(playback.clipState);
  return (
    <div className="lineup-stage">
      <ul className="lineup-tiles" aria-label="The two versions">
        {cards.map((ref, index) => {
          const card = deck.cards.find((item) => item.id === ref.cardId);
          const letter = SIDES[index].toUpperCase();
          const now = playing && playingKey === ref.cardId;
          return (
            <li key={ref.cardId} className={now ? "lineup-tile playing" : "lineup-tile"}>
              <span className="tile-letter">{letter}</span>
              {card && player ? (
                <button
                  className={now ? "" : "primary"}
                  onClick={() =>
                    now ? stop() : void play(card, clipStartFor(card, deck, 0), clipLengthFor(session))
                  }
                >
                  {now ? `Stop ${letter}` : `Play ${letter}`}
                </button>
              ) : (
                <span className="muted">
                  {card ? "Choose how to play songs on Play home." : "Not in the open deck"}
                </span>
              )}
              {now ? <span className="tile-state">Playing</span> : null}
            </li>
          );
        })}
      </ul>
      <ClipStatus playback={playback} status={status} error={error} />
    </div>
  );
}

function PickEntry({ id, heading, onLock }: { id: string; heading: string; onLock: (pick: Side, year: number | undefined) => string }) {
  const [pick, setPick] = useState<Side>();
  const [year, setYear] = useState("");
  return (
    <EntryForm
      heading={heading}
      onLock={() => {
        if (!pick) return "Pick A or B.";
        if (year.trim() === "") return onLock(pick, undefined);
        const parsed = parseYear(year);
        return parsed === undefined ? "Enter a year from 1850 to 2100, or leave it empty." : onLock(pick, parsed);
      }}
    >
      <div className="segmented" role="group" aria-label="Which is the original?">
        {SIDES.map((side) => (
          <button key={side} type="button" aria-pressed={pick === side} onClick={() => setPick(side)}>
            {side.toUpperCase()}
          </button>
        ))}
      </div>
      <YearField id={id} label="Year of the original (optional)" value={year} onChange={setYear} />
    </EntryForm>
  );
}

function ImposterInput({ controller, state }: ModeInputProps) {
  return (
    <LockedEntry players={state.players} pending={pendingInputs(state)}>
      {(player) => (
        <PickEntry
          id={`imposter-year-${player.id}`}
          heading={`${player.name}: which is the original?`}
          onLock={(pick, year) =>
            send(controller, {
              type: "choose",
              playerId: player.id,
              pick,
              ...(year !== undefined && { year }),
            })
          }
        />
      )}
    </LockedEntry>
  );
}

const RELATIONS = { coverOf: "a cover", remasterOf: "a remaster", originalOf: "another version" } as const;
// How the other version relates to the original, from the deck's relatedTo.
function relationText(deck: Deck, original: CardRef, other: CardRef): string {
  const otherCard = deck.cards.find((card) => card.id === other.cardId);
  const originalCard = deck.cards.find((card) => card.id === original.cardId);
  if (otherCard?.relatedTo?.cardId === original.cardId) return RELATIONS[otherCard.relatedTo.relation];
  if (originalCard?.relatedTo?.cardId === other.cardId && originalCard.relatedTo.relation === "originalOf")
    return RELATIONS.originalOf;
  return "another version";
}
function sides(session: Session): { original: CardRef; other: CardRef; originalSide: Side } | undefined {
  const pair = lastPair(session);
  if (!pair) return undefined;
  const otherSide: Side = pair.original === "a" ? "b" : "a";
  return { original: pair[pair.original], other: pair[otherSide], originalSide: pair.original };
}

function ImposterReveal({ session, deck }: { info: RevealInfo; session: Session; deck: Deck }) {
  const pair = sides(session);
  if (!pair) return null;
  const { original, other, originalSide } = pair;
  const letter = originalSide.toUpperCase();
  const otherLetter = originalSide === "a" ? "B" : "A";
  const describe = (ref: CardRef) => {
    const { title, artist } = cardTitle(deck, ref.cardId);
    return `${title} by ${artist} (${ref.year})`;
  };
  return (
    <div className="imposter-reveal">
      <p className="reveal-note">
        {letter} is the original: {describe(original)}.
      </p>
      <p className="reveal-note">
        {otherLetter} is {relationText(deck, original, other)} of it: {describe(other)}.
      </p>
    </div>
  );
}

const bonusGain = (info: RevealInfo, id: string): boolean =>
  (info.after.bonuses?.[id] ?? 0) > (info.before.bonuses?.[id] ?? 0);

export const imposterUI: ModeUI = {
  Input: ImposterInput,
  Stage: ImposterStage,
  heroCard: (_info, session) => sides(session)?.original,
  resultLines: (info, session) => {
    const originalSide = lastPair(session)?.original;
    return info.inputs.flatMap((action) =>
      action.type === "choose"
        ? [
            {
              playerId: action.playerId,
              text: `${signed(deltas(info, action.playerId).points)}, picked ${action.pick.toUpperCase()}${action.pick === originalSide ? " (the original)" : ""}${action.year !== undefined ? `, guessed ${action.year}` : ""}${bonusGain(info, action.playerId) ? ", year bonus" : ""}`,
            },
          ]
        : [],
    );
  },
  RevealExtra: ImposterReveal,
  tieBreaks: (summary, id) => [`${summary.bonuses?.[id] ?? 0} year bonuses`],
};
