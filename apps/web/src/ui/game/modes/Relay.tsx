import { useState } from "react";
import { timelineOf } from "../../../core/game/engine";
import { nameItAward } from "../../../core/scoring";
import type { CardRef, RelayOptions, Session } from "../../../core/session";
import { inputsSinceDraw, playerName, refById, type RevealInfo } from "../history";
import { send } from "./LockedEntry";
import { NameIt, nameItText, placementMarkers } from "./Timeline";
import { TimelineStrip } from "./TimelineStrip";
import type { ModeInputProps, ModeUI } from "./types";

// One shared line; the turn's voice places the card after the team debates.
function RelayInput({ controller, session, state, summary, deck }: ModeInputProps) {
  const options = state.options as RelayOptions;
  const voice = summary.active!;
  const name = playerName(session, voice);
  const inputs = inputsSinceDraw(session.actions);
  const placed = inputs.some((action) => action.type === "place");
  const named = inputs.find((action) => action.type === "nameIt");
  const [error, setError] = useState("");
  return (
    <div className="timeline-input">
      <p className="relay-status">
        <span className="badge">Voice: {name}</span>
        <span className="badge">
          Lives {summary.lives} of {options.lives}
        </span>
      </p>
      <h3>{placed ? `${name} placed the card` : `Where does this song go? ${name} decides.`}</h3>
      <TimelineStrip
        key={placed ? "placed" : "place"}
        cards={timelineOf(state)}
        deck={deck}
        label="The team's line"
        markers={placementMarkers(session, inputs)}
        onSlot={placed ? undefined : (slot) => setError(send(controller, { type: "place", playerId: voice, slot }))}
      />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {placed && options.nameIt ? (
        named && named.type === "nameIt" ? (
          <p role="status">{nameItText(named.titleOK, named.artistOK)}</p>
        ) : (
          <NameIt
            onRecord={(titleOK, artistOK) => send(controller, { type: "nameIt", playerId: voice, titleOK, artistOK })}
          />
        )
      ) : null}
    </div>
  );
}

// Name It is judged before the placement (6.6): an award gives back a life, up to the start.
function relayNameItText(info: RevealInfo, session: Session, titleOK: boolean, artistOK: boolean): string {
  if (!nameItAward(titleOK, artistOK)) return nameItText(titleOK, artistOK);
  const max = (session.options.lives as number | undefined) ?? 3;
  return (info.before.lives ?? 0) >= max
    ? "Named it, but lives were already full."
    : "Named it: a life back before the placement.";
}
function teamOutcome(outcome: RevealInfo["after"]["outcome"]): string {
  if (outcome === "won") return "The line is complete. The team wins!";
  if (outcome === "lost") return "Out of lives. The team loses.";
  return "";
}
function RelayReveal({ info, session, deck }: { info: RevealInfo; session: Session; deck: ModeInputProps["deck"] }) {
  const grew = (info.after.timeline?.length ?? 0) > (info.before.timeline?.length ?? 0);
  const cards = (info.after.timeline ?? []).flatMap((id): CardRef[] => {
    const ref = refById(session, id);
    return ref ? [ref] : [];
  });
  const max = (session.options.lives as number | undefined) ?? 3;
  return (
    <div className="timeline-reveal">
      <p className="reveal-note">
        {grew ? `Correct! The line now has ${cards.length} cards.` : "Wrong. The card is discarded and the team loses a life."}
      </p>
      <p className="reveal-note">
        Lives {info.after.lives} of {max} · Team score {info.after.teamScore}
      </p>
      {teamOutcome(info.after.outcome) ? <p className="reveal-note">{teamOutcome(info.after.outcome)}</p> : null}
      <TimelineStrip cards={cards} deck={deck} label="The team's line" compact />
    </div>
  );
}

export const relayUI: ModeUI = {
  Input: RelayInput,
  resultLines: (info, session) =>
    info.inputs.flatMap((action) =>
      action.type === "nameIt"
        ? [{ playerId: action.playerId, text: relayNameItText(info, session, action.titleOK, action.artistOK) }]
        : [],
    ),
  RevealExtra: RelayReveal,
  ResultsExtra: ({ summary }) => (
    <div className="relay-results">
      <p className="reveal-note">
        {teamOutcome(summary.outcome) || "The game was ended."} Team score {summary.teamScore}, a line of{" "}
        {summary.timeline?.length ?? 0} cards with {summary.lives} lives left.
      </p>
    </div>
  ),
};
