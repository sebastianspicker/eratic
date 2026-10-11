import { eraFor, eraStyle } from "../../eras";
import { cardTitle, inputsSinceDraw, playerName, refById } from "../history";
import { send } from "./LockedEntry";
import type { ModeInputProps, ModeUI } from "./types";

const CALLS = { earlier: "Earlier", later: "Later" } as const;

// The reference card's chip, the mystery card, Earlier and Later, and the streak.
function HigherLowerInput({ controller, session, summary, deck }: ModeInputProps) {
  const reference = refById(session, summary.reference);
  const active = summary.active!;
  const name = playerName(session, active);
  const call = inputsSinceDraw(session.actions).find((action) => action.type === "call");
  const { title, artist } = reference ? cardTitle(deck, reference.cardId) : { title: "", artist: "" };
  return (
    <div className="higher-lower">
      <div className="hl-row">
        {reference ? (
          <div className="hl-reference">
            <span className="muted">Last song</span>
            <span className="row-year" style={eraStyle(eraFor(reference.year))}>
              {reference.year}
            </span>
            <strong>{title}</strong>
            <span>{artist}</span>
          </div>
        ) : null}
        <span className="hl-versus" aria-hidden="true">
          vs
        </span>
        <div className="mystery-card small">
          <span className="mystery-mark" aria-hidden="true">
            ?
          </span>
          <span>This song</span>
        </div>
      </div>
      <p className="streak">
        {name}'s streak: {summary.streaks?.[active] ?? 0}
      </p>
      {call && call.type === "call" ? (
        <p role="status">
          {name} called {CALLS[call.call]}. Reveal when ready.
        </p>
      ) : (
        <div className="action-row" role="group" aria-label={`${name}'s call`}>
          {(["earlier", "later"] as const).map((value) => (
            <button
              key={value}
              className="primary"
              onClick={() => send(controller, { type: "call", playerId: active, call: value })}
            >
              {CALLS[value]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export const higherLowerUI: ModeUI = {
  Input: HigherLowerInput,
  resultLines: (info) =>
    info.inputs.flatMap((action) => {
      if (action.type !== "call") return [];
      const id = action.playerId;
      const streak = info.after.streaks?.[id] ?? 0;
      const right = streak > (info.before.streaks?.[id] ?? 0);
      const out =
        (info.after.eliminated ?? []).includes(id) && !(info.before.eliminated ?? []).includes(id);
      return [
        {
          playerId: id,
          text: `called ${CALLS[action.call]}: ${right ? `right, streak ${streak}` : out ? "missed, out" : "missed"}`,
        },
      ];
    }),
  RevealExtra: ({ info, session, deck }) => {
    const reference = refById(session, info.before.reference);
    if (!reference) return null;
    return (
      <p className="reveal-note">
        Compared with {cardTitle(deck, reference.cardId).title} ({reference.year})
      </p>
    );
  },
  tieBreaks: (summary, id) => [(summary.eliminated ?? []).includes(id) ? "Out" : "Still in"],
};
