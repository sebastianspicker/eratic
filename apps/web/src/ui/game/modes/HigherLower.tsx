import { eraFor, eraStyle } from "../../eras";
import { useState } from "react";
import { pendingInputs } from "../../../core/game/engine";
import type { Session, SessionPlayer } from "../../../core/session";
import { cardTitle, inputsSinceDraw, playerLives, playerName, refById } from "../history";
import { EntryForm, LockedEntry, send } from "./LockedEntry";
import type { ModeInputProps, ModeUI } from "./types";

const CALLS = { earlier: "Earlier", later: "Later" } as const;

const isEveryone = (session: Session): boolean => session.options.play === "everyone";

// One player's call in "everyone" play: choose, then lock in; the list shows only "Locked".
function EveryoneCall({ controller, player }: { controller: ModeInputProps["controller"]; player: SessionPlayer }) {
  const [choice, setChoice] = useState<"earlier" | "later" | undefined>();
  return (
    <EntryForm
      heading={`${player.name}'s call`}
      onLock={() => {
        if (!choice) return "Choose Earlier or Later.";
        return send(controller, { type: "call", playerId: player.id, call: choice });
      }}
    >
      <div className="action-row" role="group" aria-label={`${player.name}'s call`}>
        {(["earlier", "later"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={choice === value} onClick={() => setChoice(value)}>
            {CALLS[value]}
          </button>
        ))}
      </div>
    </EntryForm>
  );
}

// The reference card's chip, the mystery card, Earlier and Later, and the streak.
function HigherLowerInput({ controller, session, state, summary, deck, reveal }: ModeInputProps) {
  const reference = refById(session, summary.reference);
  const everyone = isEveryone(session);
  const active = summary.active;
  const name = active ? playerName(session, active) : "";
  const call = inputsSinceDraw(session.actions).find((action) => action.type === "call");
  const { title, artist } = reference ? cardTitle(deck, reference.cardId) : { title: "", artist: "" };
  const out = summary.eliminated ?? [];
  const pending = pendingInputs(state);
  const callers = session.players.filter((player) => !out.includes(player.id));
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
      {everyone ? (
        <>
          <LockedEntry players={callers} pending={pending}>
            {(player) => <EveryoneCall controller={controller} player={player} />}
          </LockedEntry>
          {out.length > 0 ? (
            <ul className="lock-list" aria-label="Out">
              {session.players
                .filter((player) => out.includes(player.id))
                .map((player) => (
                  <li key={player.id}>
                    <span>{player.name}</span>
                    <span className="lock-state">Out</span>
                  </li>
                ))}
            </ul>
          ) : null}
        </>
      ) : active ? (
        <p className="streak">
          {name}'s streak: {summary.streaks?.[active] ?? 0}
        </p>
      ) : null}
      {everyone || !active ? null : call && call.type === "call" ? (
        <p role="status">
          {name} called {CALLS[call.call]}.
        </p>
      ) : (
        <div className="action-row" role="group" aria-label={`${name}'s call`}>
          {(["earlier", "later"] as const).map((value) => (
            <button
              key={value}
              className="primary"
              onClick={() => {
                // One decision: the call and the reveal go together.
                if (!send(controller, { type: "call", playerId: active!, call: value })) reveal();
              }}
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
  // Turns: one decision, so the call reveals. Everyone: the host reveals once all have called.
  // A turn with a call but no reveal (saved between the two) uses the generic Reveal.
  ownReveal: (session) =>
    !isEveryone(session) && !inputsSinceDraw(session.actions).some((action) => action.type === "call"),
  resultLines: (info) =>
    info.inputs.flatMap((action) => {
      if (action.type !== "call") return [];
      const id = action.playerId;
      const streak = info.after.streaks?.[id] ?? 0;
      const right = streak > (info.before.streaks?.[id] ?? 0);
      const lives = playerLives(info.after)?.[id];
      const out = lives !== undefined
        ? lives === 0
        : (info.after.eliminated ?? []).includes(id) && !(info.before.eliminated ?? []).includes(id);
      const missed = out
        ? "missed, out"
        : lives !== undefined
          ? `missed, ${lives} ${lives === 1 ? "life" : "lives"} left`
          : "missed";
      return [
        {
          playerId: id,
          text: `called ${CALLS[action.call]}: ${right ? `right, streak ${streak}` : missed}`,
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
  tieBreaks: (summary, id) => {
    const lives = playerLives(summary)?.[id];
    if ((summary.eliminated ?? []).includes(id)) return ["Out"];
    return lives === undefined ? ["Still in"] : ["Still in", `${lives} ${lives === 1 ? "life" : "lives"} left`];
  },
};
