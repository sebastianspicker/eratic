import { useState, type FormEvent, type ReactNode } from "react";
import type { SessionPlayer } from "../../../core/session";
import type { ActionInput, GameController } from "../useGame";
import { Wager } from "./Wager";

// Guesses are entered one player at a time and shown only as "Locked" until the
// reveal, so the host device can be passed around.
export function LockedEntry({
  players,
  pending,
  children,
}: {
  players: SessionPlayer[];
  pending: string[];
  children: (player: SessionPlayer) => ReactNode;
}) {
  const current = players.find((player) => pending.includes(player.id));
  return (
    <div className="locked-entry">
      <ul className="lock-list" aria-label="Entries">
        {players.map((player) => {
          const locked = !pending.includes(player.id);
          return (
            <li key={player.id} className={locked ? "locked" : ""}>
              <span>{player.name}</span>
              <span className="lock-state">
                {locked ? "Locked" : player === current ? "Entering" : "Waiting"}
              </span>
            </li>
          );
        })}
      </ul>
      {current ? (
        <div key={current.id}>{children(current)}</div>
      ) : (
        <p className="muted" role="status">
          Everyone is locked in. Reveal when ready.
        </p>
      )}
    </div>
  );
}

// One player's entry: the field, an optional wager, and Lock in. Enter submits.
// onLock returns an error message, or "" when the entry was accepted.
export function EntryForm({
  heading,
  held,
  onLock,
  children,
}: {
  heading: string;
  // Chips held when the player must wager; undefined without Stakes.
  held?: number;
  onLock: (wager: number | undefined) => string;
  children: ReactNode;
}) {
  const [wager, setWager] = useState(1);
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    setError(onLock(held !== undefined && held > 0 ? Math.min(wager, held, 3) : undefined));
  }
  return (
    <form className="entry-form" onSubmit={submit}>
      <h3>{heading}</h3>
      {children}
      {held !== undefined ? <Wager held={held} value={wager} onChange={setWager} /> : null}
      <div className="action-row">
        <button className="primary" type="submit">
          Lock in
        </button>
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

// Dispatches in order; returns the engine's message for the first rejected action.
export function send(controller: GameController, ...actions: ActionInput[]): string {
  for (const action of actions)
    if (!controller.dispatch(action)) return controller.getSnapshot().notice;
  return "";
}
