import { useEffect, useState } from "react";
import { openChallengeSlots, timelineOf } from "../../../core/game/engine";
import type { CardRef, Session, TimelineOptions } from "../../../core/session";
import { chipsText, deltas, inputsSinceDraw, playerName, refById, signed, type RevealInfo } from "../history";
import { send } from "./LockedEntry";
import { TimelineStrip } from "./TimelineStrip";
import type { ModeInputProps, ModeUI } from "./types";
import { Wager } from "./Wager";

// Name It: the host judges title and artist, then records it.
export function NameIt({ onRecord }: { onRecord: (titleOK: boolean, artistOK: boolean) => string }) {
  const [title, setTitle] = useState(false);
  const [artist, setArtist] = useState(false);
  const [error, setError] = useState("");
  return (
    <fieldset className="name-it">
      <legend>Name It</legend>
      <label className="checkbox-label">
        <input type="checkbox" checked={title} onChange={(event) => setTitle(event.target.checked)} />
        Title right
      </label>
      <label className="checkbox-label">
        <input type="checkbox" checked={artist} onChange={(event) => setArtist(event.target.checked)} />
        Artist right
      </label>
      <div className="action-row">
        <button type="button" onClick={() => setError(onRecord(title, artist))}>
          Record Name It
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
export function nameItText(titleOK: boolean, artistOK: boolean): string {
  return `Name It recorded: title ${titleOK ? "right" : "wrong"}, artist ${artistOK ? "right" : "wrong"}.`;
}

// The turn's placement on the active player's (or the shared) line, marked "Your slot".
export function placementMarkers(session: Session, inputs: ReturnType<typeof inputsSinceDraw>): Record<number, string> {
  const markers: Record<number, string> = {};
  for (const action of inputs) {
    if (action.type === "place") markers[action.slot] = "Your slot";
    if (action.type === "challenge") markers[action.slot] = `${playerName(session, action.playerId)}'s challenge`;
  }
  return markers;
}

function WagerEntry({ held, name, onWager }: { held: number; name: string; onWager: (chips: number) => string }) {
  const [chips, setChips] = useState(1);
  const [error, setError] = useState("");
  return (
    <div className="wager-entry">
      <Wager held={held} value={chips} onChange={setChips} playerName={name} rule="Win the wager if your placement is right." />
      {held > 0 ? (
        <div className="action-row">
          <button type="button" onClick={() => setError(onWager(Math.min(chips, held, 3)))}>
            Place wager
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// The active player places the card; then challenges, Name It and the wager.
function TimelineInput({ controller, session, state, summary, deck }: ModeInputProps) {
  const options = state.options as TimelineOptions;
  const active = summary.active!;
  const name = playerName(session, active);
  const personal = options.ownership === "personal";
  const line = timelineOf(state, active);
  const inputs = inputsSinceDraw(session.actions);
  const placed = inputs.find((action) => action.type === "place");
  const challenges = inputs.filter((action) => action.type === "challenge");
  const named = inputs.find((action) => action.type === "nameIt");
  const [challenger, setChallenger] = useState<string>();
  const [error, setError] = useState("");
  // An undone placement takes its open challenge picker with it.
  useEffect(() => {
    if (!placed) setChallenger(undefined);
  }, [placed]);
  const markers = placementMarkers(session, inputs);
  const freeSlots = openChallengeSlots(state);
  const others = session.players.filter((player) => player.id !== active);
  const wagered = Object.hasOwn(state.wagers, active);
  const lineLabel = personal ? `${name}'s timeline` : "Shared timeline";

  let main;
  if (!placed)
    main = (
      <>
        <h3>{name}, where does this song go?</h3>
        <TimelineStrip
          key="place"
          cards={line}
          deck={deck}
          label={lineLabel}
          onSlot={(slot) => setError(send(controller, { type: "place", playerId: active, slot }))}
        />
      </>
    );
  else if (challenger)
    main = (
      <>
        <h3>{playerName(session, challenger)}, choose a free slot</h3>
        <TimelineStrip
          key={`challenge-${challenger}`}
          cards={line}
          deck={deck}
          label={lineLabel}
          markers={markers}
          verb="Challenge"
          open={(slot) => freeSlots.includes(slot)}
          onSlot={(slot) => {
            const problem = send(controller, { type: "challenge", playerId: challenger, slot });
            setError(problem);
            if (!problem) setChallenger(undefined);
          }}
        />
        <div className="action-row">
          <button type="button" onClick={() => setChallenger(undefined)}>
            Cancel challenge
          </button>
        </div>
      </>
    );
  else
    main = (
      <>
        <h3>{name} placed the card</h3>
        <TimelineStrip key="placed" cards={line} deck={deck} label={lineLabel} markers={markers} />
      </>
    );

  return (
    <div className="timeline-input">
      {main}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {placed && !challenger ? (
        <div className="turn-extras">
          {options.challenges ? (
            <section className="challenges" aria-label="Challenges">
              <h3>Challenges</h3>
              <ul className="challenge-list">
                {others.map((player) => {
                  const tokens = summary.tokens?.[player.id] ?? 0;
                  const done = challenges.some((action) => action.type === "challenge" && action.playerId === player.id);
                  return (
                    <li key={player.id}>
                      <span>
                        {player.name} · Tokens {tokens}
                      </span>
                      {done ? (
                        <span className="lock-state">Challenged</span>
                      ) : tokens < 1 ? (
                        <span className="muted">No tokens</span>
                      ) : freeSlots.length === 0 ? (
                        <span className="muted">No free slot</span>
                      ) : (
                        <button type="button" onClick={() => setChallenger(player.id)}>
                          Challenge as {player.name}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          {options.nameIt ? (
            named && named.type === "nameIt" ? (
              <p role="status">{nameItText(named.titleOK, named.artistOK)}</p>
            ) : (
              <NameIt
                onRecord={(titleOK, artistOK) =>
                  send(controller, { type: "nameIt", playerId: active, titleOK, artistOK })
                }
              />
            )
          ) : null}
          {state.chips && !wagered ? (
            <WagerEntry
              held={state.chips[active]}
              name={name}
              onWager={(chips) => send(controller, { type: "wager", playerId: active, chips })}
            />
          ) : null}
          {state.chips && wagered ? (
            <p role="status">
              {name} wagered {state.wagers[active]} chip{state.wagers[active] === 1 ? "" : "s"}.
            </p>
          ) : null}
        </div>
      ) : null}
      {personal ? (
        <div className="other-timelines">
          {others.map((player) => (
            <div key={player.id}>
              <h4>{player.name}</h4>
              <TimelineStrip
                cards={timelineOf(state, player.id)}
                deck={deck}
                label={`${player.name}'s timeline`}
                compact
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Who got the card, from the engine's score changes.
function outcome(info: RevealInfo, session: Session): string {
  const active = info.before.active!;
  if (deltas(info, active).points > 0) return `Correct! ${playerName(session, active)} keeps it.`;
  const taker = session.players.find((player) => player.id !== active && deltas(info, player.id).points > 0);
  return taker ? `${taker.name} takes the card.` : "Discarded.";
}
const tokenGain = (info: RevealInfo, id: string): number =>
  (info.after.tokens?.[id] ?? 0) - (info.before.tokens?.[id] ?? 0);

// The personal player whose line gained the drawn card, read from the engine's
// summary after the reveal; undefined when nobody got it or the line is shared.
function lineGainer(info: RevealInfo): string | undefined {
  const drawn = info.cards[0].cardId;
  return Object.entries(info.after.timelines ?? {}).find(([, ids]) => ids.includes(drawn))?.[0];
}
// Who got the card, for either ownership: the owner of the line that gained it, or
// (shared line) the player the engine credited.
function cardTaker(info: RevealInfo, session: Session): string | undefined {
  if (info.after.timelines) return lineGainer(info);
  return session.players.find((player) => deltas(info, player.id).points > 0)?.id;
}

function TimelineReveal({ info, session, deck }: { info: RevealInfo; session: Session; deck: ModeInputProps["deck"] }) {
  const active = info.before.active!;
  // The line that took the card (or the active player's when nobody did), the new card marked.
  const shown = lineGainer(info) ?? active;
  const ids = info.after.timelines?.[shown] ?? info.after.timeline ?? [];
  const cards = ids.flatMap((id): CardRef[] => {
    const ref = refById(session, id);
    return ref ? [ref] : [];
  });
  const personal = info.after.timelines !== undefined;
  return (
    <div className="timeline-reveal">
      <p className="reveal-note">{outcome(info, session)}</p>
      {tokenGain(info, active) > 0 ? (
        <p className="reveal-note">{playerName(session, active)} named it and gains a token.</p>
      ) : null}
      <TimelineStrip
        cards={cards}
        deck={deck}
        label={personal ? `${playerName(session, shown)}'s timeline` : "Shared timeline"}
        newCardId={info.cards[0].cardId}
        compact
      />
    </div>
  );
}

// A challenge that scored, or one that lost the card to whoever got it.
function challengeText(info: RevealInfo, session: Session, playerId: string): string {
  if (deltas(info, playerId).points > 0) return "+1 card from the challenge";
  const taker = cardTaker(info, session);
  return taker ? `token spent, ${playerName(session, taker)} got the card` : "challenge missed, token spent";
}

export const timelineUI: ModeUI = {
  Input: TimelineInput,
  resultLines: (info, session) => {
    const active = info.before.active!;
    const lines = [];
    const own = deltas(info, active);
    lines.push({
      playerId: active,
      text: `${own.points > 0 ? `${signed(own.points)} card` : "no card"}${chipsText(own.chips)}${tokenGain(info, active) > 0 ? ", +1 token" : ""}`,
    });
    for (const action of info.inputs)
      if (action.type === "challenge")
        lines.push({ playerId: action.playerId, text: challengeText(info, session, action.playerId) });
    return lines;
  },
  RevealExtra: TimelineReveal,
  tieBreaks: (summary, id) => [`${summary.wrong?.[id] ?? 0} wrong placements`],
};
