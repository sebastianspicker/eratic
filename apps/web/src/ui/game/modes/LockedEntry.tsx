import { useState, type FormEvent, type ReactNode } from "react";
import type { SessionPlayer } from "../../../core/session";
import { loadEntryStyle, saveEntryStyle, type EntryStyle } from "../../../sessions";
import type { ActionInput, GameController } from "../useGame";
import { Wager } from "./Wager";

// Guesses are entered one player at a time and shown only as "Locked" until the
// reveal, so the host device can be passed around. A mode that passes allAtOnce
// also offers one form with every pending player's field, remembered per device
// (not to a single player, who has nobody to enter for).
export function LockedEntry({
  players,
  pending,
  hideList = false,
  children,
  allAtOnce,
}: {
  players: SessionPlayer[];
  pending: string[];
  // A single player (Daily) has nobody to pass the device to, so no list.
  hideList?: boolean;
  children: (player: SessionPlayer) => ReactNode;
  allAtOnce?: ReactNode;
}) {
  const current = players.find((player) => pending.includes(player.id));
  const [style, setStyle] = useState<EntryStyle>(() => (allAtOnce ? loadEntryStyle() : "each"));
  const toggle = allAtOnce !== undefined && players.length > 1;
  const all = toggle && style === "all";
  function choose(next: EntryStyle) {
    setStyle(next);
    saveEntryStyle(next);
  }
  const everyone = (
    <p className="muted" role="status">
      {players.length === 1 ? "Locked in. Reveal when ready." : "Everyone is locked in. Reveal when ready."}
    </p>
  );
  return (
    <div className="locked-entry">
      {toggle ? (
        <div className="segmented" role="group" aria-label="Entry style">
          {(
            [
              ["each", "One at a time"],
              ["all", "All at once"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={style === value} onClick={() => choose(value)}>
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {all ? (
        current ? (
          allAtOnce
        ) : (
          everyone
        )
      ) : (
        <>
          {hideList ? null : <ul className="lock-list" aria-label="Entries">
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
          </ul>}
          {current ? <div key={current.id}>{children(current)}</div> : everyone}
        </>
      )}
    </div>
  );
}

// One player's entry: the field, an optional wager, and Lock in. Enter submits.
// onLock returns an error message, or "" when the entry was accepted.
export function EntryForm({
  heading,
  held,
  playerName,
  wagerRule,
  onLock,
  children,
}: {
  heading: string;
  // Chips held when the player must wager; undefined without Stakes.
  held?: number;
  playerName?: string;
  // What wins the wager, shown with it.
  wagerRule?: string;
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
      {held !== undefined ? <Wager held={held} value={wager} onChange={setWager} playerName={playerName} rule={wagerRule} /> : null}
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

// Every pending player's field on one form; locked players show "Locked".
// Lock in all checks every row first and sends nothing unless all are valid,
// then projects them through the engine and sends each player's actions in player order.
// build returns a player's actions, or the message saying what is wrong.
export function AllAtOnceForm<T>({
  heading,
  controller,
  players,
  pending,
  initial,
  field,
  build,
  held,
  wagerRule,
}: {
  heading: string;
  controller: GameController;
  players: SessionPlayer[];
  pending: string[];
  initial: T;
  field: (player: SessionPlayer, value: T, onChange: (value: T) => void) => ReactNode;
  build: (player: SessionPlayer, value: T, wager: number | undefined) => ActionInput[] | string;
  // Chips held when the player must wager; undefined without Stakes.
  held?: (player: SessionPlayer) => number | undefined;
  // What wins the wager, shown with each wager.
  wagerRule?: string;
}) {
  const [values, setValues] = useState<Record<string, T>>({});
  const [wagers, setWagers] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<string[]>([]);
  function submit(event: FormEvent) {
    event.preventDefault();
    const sends: ActionInput[] = [];
    const problems: string[] = [];
    for (const player of players) {
      if (!pending.includes(player.id)) continue;
      const chips = held?.(player);
      const wager = chips !== undefined && chips > 0 ? Math.min(wagers[player.id] ?? 1, chips, 3) : undefined;
      const built = build(player, values[player.id] ?? initial, wager);
      if (typeof built === "string") problems.push(`${player.name}: ${built}`);
      else sends.push(...built);
    }
    setErrors(problems);
    if (problems.length > 0) return;
    // Atomic: the engine must accept every action before any is recorded.
    if (!controller.project(sends)) {
      const notice = controller.getSnapshot().notice;
      setErrors([`Couldn't lock everyone in: ${notice || "the engine rejected an entry."}`]);
      return;
    }
    const from = controller.getSnapshot().session?.actions.length ?? 0;
    const failure = send(controller, ...sends);
    if (failure) setErrors([failure]);
    else controller.markBatch(from, new Set(sends.map((action) => "playerId" in action && action.playerId)).size);
  }
  return (
    <form className="entry-form" onSubmit={submit}>
      <h3>{heading}</h3>
      <ul className="all-at-once" aria-label="Entries">
        {players.map((player) => {
          const chips = held?.(player);
          return pending.includes(player.id) ? (
            <li key={player.id}>
              <span>{player.name}</span>
              {field(player, values[player.id] ?? initial, (value) =>
                setValues((current) => ({ ...current, [player.id]: value })),
              )}
              {chips !== undefined ? (
                <Wager
                  held={chips}
                  value={wagers[player.id] ?? 1}
                  onChange={(value) => setWagers((current) => ({ ...current, [player.id]: value }))}
                  playerName={player.name}
                  rule={wagerRule}
                />
              ) : null}
            </li>
          ) : (
            <li key={player.id} className="locked">
              <span>{player.name}</span>
              <span className="lock-state">Locked</span>
            </li>
          );
        })}
      </ul>
      <div className="action-row">
        <button className="primary" type="submit">
          Lock in all
        </button>
      </div>
      {errors.length > 0 ? (
        <div className="error" role="alert">
          {errors.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
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
