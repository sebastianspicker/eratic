import { useEffect, useRef, useState } from "react";
import { canReveal, currentCards, pendingInputs } from "../../../core/game/engine";
import type { GameAction, LadderOptions, Session } from "../../../core/session";
import { loadCalibration } from "../../../playback/calibration";
import { exactClips, type PlaybackProvider } from "../../../playback/player";
import { cardTitle, chipsText, deltas, inputsSinceDraw, listNames, playerName, signed } from "../history";
import { clipPlaying, PROVIDER_NAMES, useCardPlayer } from "../playback";
import { ClipStatus, MysteryCard, Nudge, useClipStart } from "../Stage";
import { send } from "./LockedEntry";
import type { ModeInputProps, ModeUI } from "./types";
import { Wager } from "./Wager";
import { parseYear, YearField } from "./YearField";

const seconds = (ms: number): string => `${ms / 1000} s`;

// A warning, never a block, when exact clips haven't passed calibration (ADR 0011).
export function calibrationWarning(provider: PlaybackProvider | undefined, exact: boolean): string {
  if (!provider || !exact) return "";
  const result = loadCalibration(provider);
  if (!result)
    return `${PROVIDER_NAMES[provider]} timing isn't calibrated yet, so short steps may run long. Calibrate on Play home.`;
  return result.passed
    ? ""
    : `${PROVIDER_NAMES[provider]} timing failed calibration, so short steps may run long or short.`;
}

// The step each player locked at, read from the card's step and lock actions.
function lockSteps(inputs: GameAction[]): Map<string, number> {
  const locks = new Map<string, number>();
  let step = -1;
  for (const action of inputs) {
    if (action.type === "step") step = action.index;
    if (action.type === "lock") locks.set(action.playerId, step);
  }
  return locks;
}
const isTextField = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName));

// The step bar and the clip buttons; each step plays exactly its length from the clip start.
function LadderStage({ controller, session, state, summary, deck, playback }: ModeInputProps) {
  const options = state.options as LadderOptions;
  const step = summary.step ?? -1;
  const last = options.steps.length - 1;
  const card = deck.cards.find((item) => item.id === currentCards(state)[0]?.cardId);
  const { start, earlier, later } = useClipStart(card, deck, session);
  const { player, exact, play, stop, status, error } = useCardPlayer(playback, controller);
  const next = step < last ? step + 1 : undefined;
  // The step is recorded once its clip is audible; a clip that fails to start
  // shows why and leaves the ladder where it was.
  function playStep(index: number) {
    if (!card || !exact || !controller.project([{ type: "step", index }])) return;
    void play(card, start, options.steps[index], `step-${index}`, () =>
      controller.dispatch({ type: "step", index }),
    );
  }
  const latest = useRef(playStep);
  latest.current = playStep;
  // Space plays the next step, unless focus is in a field or on a button (which Space presses).
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== " " || event.repeat || isTextField(event.target) || next === undefined) return;
      event.preventDefault();
      latest.current(next);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next]);
  const warning = calibrationWarning(playback.hubState.provider, Boolean(playback.hubState.tier && exactClips(playback.hubState.tier)));
  return (
    <div className="card-stage">
      <MysteryCard />
      <div className="clip-controls">
        <ol className="step-bar" aria-label="Clip steps">
          {options.steps.map((length, index) => (
            <li
              key={length}
              className={`${index <= step ? "played" : ""}${index === step ? " current" : ""}`}
              aria-current={index === step ? "step" : undefined}
            >
              {seconds(length)}
              <span className="visually-hidden">
                {index === step ? " (current)" : index < step ? " (played)" : ""}
              </span>
            </li>
          ))}
        </ol>
        {!card ? <p className="muted">This card isn't in the open deck, so it can't be played here.</p> : null}
        {card && !player ? <p className="muted">Choose how to play songs on Play home to hear this card.</p> : null}
        {card && player && !exact ? <p className="muted">Snippet Ladder needs exact clips to play each step.</p> : null}
        <div className="action-row">
          {next !== undefined ? (
            <button className="primary" disabled={!card || !exact} onClick={() => playStep(next)}>
              {step < 0 ? `Play ${seconds(options.steps[0])}` : `Next: ${seconds(options.steps[next])}`}
            </button>
          ) : null}
          {step >= 0 ? (
            <button disabled={!card || !exact} onClick={() => playStep(step)}>
              Replay step
            </button>
          ) : null}
          {clipPlaying(playback.clipState) ? <button onClick={stop}>Stop</button> : null}
        </div>
        {exact ? <Nudge start={start} onEarlier={earlier} onLater={later} /> : null}
        <ClipStatus playback={playback} status={status} error={error} />
        {warning ? <p className="warning">{warning}</p> : null}
      </div>
    </div>
  );
}

function WagerRow({ held, onWager }: { held: number; onWager: (chips: number) => string }) {
  const [chips, setChips] = useState(1);
  const [error, setError] = useState("");
  return (
    <>
      <Wager held={held} value={chips} onChange={setChips} />
      {held > 0 ? (
        <button type="button" onClick={() => setError(onWager(Math.min(chips, held, 3)))}>
          Place wager
        </button>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function LadderInput({ controller, session, state, summary, deck, reveal }: ModeInputProps) {
  const options = state.options as LadderOptions;
  const step = summary.step ?? -1;
  const withYear = options.guess !== "name";
  const marked = options.guess !== "year";
  const inputs = inputsSinceDraw(session.actions);
  const locks = lockSteps(inputs);
  const [years, setYears] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(false);
  const [marks, setMarks] = useState<Record<string, { title: boolean; artist: boolean }>>({});
  const [error, setError] = useState("");
  const players = session.players;
  const given = new Set(inputs.flatMap((action) => (action.type === "mark" ? [action.playerId] : [])));
  // The marks Score card would record, with the host's toggles so far.
  const markActions = marked
    ? players
        .filter((player) => locks.has(player.id) && !given.has(player.id))
        .map((player) => ({
          type: "mark" as const,
          playerId: player.id,
          titleOK: marks[player.id]?.title ?? false,
          artistOK: marks[player.id]?.artist ?? false,
        }))
    : [];
  // The engine decides: with the marks the host is about to give, would it reveal?
  const projected = controller.project(markActions);
  const ready = projected !== undefined && canReveal(projected);
  // Still owed apart from marks: locks (before the last step) and wagers.
  const waiting = projected ? pendingInputs(projected) : pendingInputs(state);
  const waitingText = listNames(waiting.map((id) => playerName(session, id)));
  const wagerRow = (id: string) =>
    state.chips && !(id in state.wagers) ? (
      <WagerRow
        held={state.chips[id]}
        onWager={(chips) => send(controller, { type: "wager", playerId: id, chips })}
      />
    ) : state.chips ? (
      <span className="muted">Wagered {state.wagers[id]}</span>
    ) : null;

  function lock(id: string) {
    let year: number | undefined;
    if (withYear) {
      year = parseYear(years[id] ?? "");
      if (year === undefined) {
        setError("Enter a year from 1850 to 2100.");
        return;
      }
    }
    setError(send(controller, { type: "lock", playerId: id, ...(year !== undefined && { year }) }));
  }
  function score() {
    if (!ready) return;
    const problem = send(controller, ...markActions);
    if (problem) setError(problem);
    else reveal();
  }

  if (shown) {
    const card = currentCards(state)[0];
    const { title, artist } = cardTitle(deck, card.cardId);
    return (
      <div className="ladder-answer">
        <section className="answer-box" aria-label="Answer">
          <h3>The answer</h3>
          <p>
            <strong>{title}</strong> · {artist} · {card.year}
          </p>
        </section>
        {marked ? (
          players.map((player) =>
            locks.has(player.id) ? (
              <fieldset key={player.id} className="mark-row">
                <legend>
                  {player.name} (locked at {seconds(options.steps[locks.get(player.id)!])})
                </legend>
                {(["title", "artist"] as const).map((field) => (
                  <label key={field} className="checkbox-label">
                    <input
                      type="checkbox"
                      aria-label={`${player.name}: ${field === "title" ? "Title" : "Artist"} right`}
                      checked={marks[player.id]?.[field] ?? false}
                      onChange={(event) =>
                        setMarks((current) => ({
                          ...current,
                          [player.id]: {
                            title: current[player.id]?.title ?? false,
                            artist: current[player.id]?.artist ?? false,
                            [field]: event.target.checked,
                          },
                        }))
                      }
                    />
                    {field === "title" ? "Title right" : "Artist right"}
                  </label>
                ))}
              </fieldset>
            ) : (
              <p key={player.id} className="muted">
                {player.name} didn't lock in.
              </p>
            ),
          )
        ) : (
          <p className="muted">The years are scored when you score the card.</p>
        )}
        {state.chips && players.some((player) => !(player.id in state.wagers)) ? (
          <ul className="ladder-locks" aria-label="Wagers">
            {players.map((player) => (
              <li key={player.id}>
                <span className="score-name">{player.name}</span>
                {wagerRow(player.id)}
              </li>
            ))}
          </ul>
        ) : null}
        {!ready && waiting.length > 0 ? <p className="muted">Waiting for {waitingText}.</p> : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="action-row">
          <button className="primary" disabled={!ready} onClick={score}>
            Score card
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ladder-input">
      <ul className="ladder-locks" aria-label="Locks">
        {players.map((player) => {
          const at = locks.get(player.id);
          return (
            <li key={player.id} className={at !== undefined ? "locked" : ""}>
              <span className="score-name">{player.name}</span>
              {at !== undefined ? (
                <span className="lock-state">Locked at {seconds(options.steps[at])}</span>
              ) : (
                <>
                  {withYear ? (
                    <YearField
                      id={`ladder-year-${player.id}`}
                      label={`${player.name}'s year`}
                      value={years[player.id] ?? ""}
                      onChange={(value) => setYears((current) => ({ ...current, [player.id]: value }))}
                    />
                  ) : null}
                  <button type="button" disabled={step < 0} onClick={() => lock(player.id)}>
                    Lock in {player.name}
                  </button>
                </>
              )}
              {wagerRow(player.id)}
            </li>
          );
        })}
      </ul>
      {step < 0 ? (
        <p className="muted">Play the first step, then players lock in when they know it.</p>
      ) : !ready && waiting.length > 0 ? (
        <p className="muted">Waiting for {waitingText}.</p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="action-row">
        <button className="primary" disabled={!ready} onClick={() => setShown(true)}>
          Show answer
        </button>
      </div>
    </div>
  );
}

function markText(titleOK: boolean, artistOK: boolean): string {
  if (titleOK && artistOK) return "title and artist right";
  if (titleOK) return "title right";
  if (artistOK) return "artist right";
  return "neither right";
}

export const ladderUI: ModeUI = {
  Input: LadderInput,
  Stage: LadderStage,
  ownReveal: true,
  resultLines: (info, session: Session) => {
    const steps = (session.options.steps as number[] | undefined) ?? [1000, 5000, 10000, 30000, 60000];
    const locks = lockSteps(info.inputs);
    return session.players.map((player) => {
      const { points, chips } = deltas(info, player.id);
      const at = locks.get(player.id);
      if (at === undefined) return { playerId: player.id, text: `${signed(points)}, didn't lock in${chipsText(chips)}` };
      const lock = info.inputs.find((action) => action.type === "lock" && action.playerId === player.id);
      const mark = info.inputs.find((action) => action.type === "mark" && action.playerId === player.id);
      const parts = [`${signed(points)}, locked at ${seconds(steps[at])}`];
      if (mark && mark.type === "mark") parts.push(markText(mark.titleOK, mark.artistOK));
      if (lock && lock.type === "lock" && lock.year !== undefined) parts.push(`guessed ${lock.year}`);
      return { playerId: player.id, text: `${parts.join(", ")}${chipsText(chips)}` };
    });
  },
  tieBreaks: (summary, id) => [
    `${seconds(summary.usedMs?.[id] ?? 0)} used`,
    `${summary.exactYears?.[id] ?? 0} exact years`,
  ],
};

