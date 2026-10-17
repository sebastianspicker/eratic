import { Fragment, useState, type FormEvent } from "react";
import type { Deck } from "../../core/deck";
import { normalizeOptions, type GameMode, type SessionOptions } from "../../core/session";
import {
  capacityNote,
  cardsNeeded,
  deckCapacity,
  hasDifficulty,
  isEasy,
  MODE_INFO,
  OPTION_FIELDS,
  sessionOptions,
  startingOptions,
  type OptionField,
} from "./modes";
import { loadRoster } from "../../sessions";
import { listNames } from "./history";
import type { CardSource, StartSetup } from "./useGame";

// Printing is planned, not built: until then testers make their own scannable code.
export const SCAN_HINT =
  "No printed cards yet? In the Deck tab, tick “Use a direct provider link instead” under a card's QR preview, then show that code on another screen or print it, and scan it here.";

function OptionControl({
  mode,
  field,
  options,
  note,
  onChange,
}: {
  mode: GameMode;
  field: OptionField;
  options: SessionOptions;
  // Shown under a number field, muted (what the deck allows).
  note?: string;
  onChange: (value: unknown) => void;
}) {
  const id = `option-${mode}-${field.name}`;
  const value = options[field.name];
  if (field.kind === "bool")
    return (
      <label className="checkbox-label" htmlFor={id}>
        <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {field.label}
      </label>
    );
  if (field.kind === "choice")
    return (
      <div className="field">
        <label htmlFor={id}>{field.label}</label>
        <select id={id} value={String(value)} onChange={(event) => onChange(event.target.value)}>
          {field.choices.map(([choice, label]) => (
            <option key={choice} value={choice}>
              {label}
            </option>
          ))}
        </select>
      </div>
    );
  if (field.kind === "steps") {
    const steps = (value as number[] | undefined) ?? [];
    return (
      <fieldset className="field">
        <legend>{field.label}</legend>
        <div className="step-choices">
          {field.choices.map((step) => (
            <label key={step} className="checkbox-label">
              <input
                type="checkbox"
                checked={steps.includes(step)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...steps, step].sort((a, b) => a - b)
                      : steps.filter((item) => item !== step),
                  )
                }
              />
              {step / 1000} s
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  const scale = field.scale ?? 1;
  const shown = typeof value === "number" && !Number.isNaN(value) ? value / scale : "";
  return (
    <div className="field">
      <label htmlFor={id}>
        {field.label} ({field.min}–{field.max})
      </label>
      <input
        id={id}
        type="number"
        min={field.min}
        max={field.max}
        step="1"
        value={shown}
        onChange={(event) =>
          onChange(event.target.value === "" ? Number.NaN : Number(event.target.value) * scale)
        }
      />
      {note ? <p className="muted">{note}</p> : null}
    </div>
  );
}

// Players, the mode's options with the contract defaults, and the card source.
export function Setup({
  mode,
  deck,
  hasCamera,
  error,
  previewMs,
  exact = false,
  warning = "",
  onStart,
  onBack,
}: {
  mode: GameMode;
  deck: Deck;
  hasCamera: boolean;
  error: string;
  // How long previews play (a preview-only account, or no exact clips); Snippet Ladder leaves out longer steps.
  previewMs?: number;
  // The connected tier plays exact clips; Snippet Ladder's Clip start only matters then.
  exact?: boolean;
  // Shown, never blocking (Snippet Ladder's missing or failed calibration).
  warning?: string;
  onStart: (setup: StartSetup) => void;
  onBack: () => void;
}) {
  const info = MODE_INFO[mode];
  const [min, max] = info.players;
  // The last game's room, clamped to this mode's range; without one, "Player 1"….
  const [names, setNames] = useState(() => {
    const roster = loadRoster();
    if (!roster)
      return Array.from({ length: Math.max(min, Math.min(2, max)) }, (_, i) => `Player ${i + 1}`);
    const kept = roster.slice(0, max);
    while (kept.length < min) kept.push(`Player ${kept.length + 1}`);
    return kept;
  });
  const [options, setOptions] = useState(() => startingOptions(mode, names.length, deck.cards));
  const [kids, setKids] = useState(false);
  const [easyOnly, setEasyOnly] = useState(false);
  const scanPossible =
    hasCamera && !["daily", "higherLower", "lineup", "imposter"].includes(mode);
  const [source, setSource] = useState<CardSource>("draw");
  const [problem, setProblem] = useState("");
  // Rule 6.4: a preview-only account drops the steps longer than its preview before the session starts.
  const chosenSteps = mode === "ladder" ? ((options.steps as number[] | undefined) ?? []) : [];
  const dropped = previewMs === undefined ? [] : chosenSteps.filter((step) => step > previewMs);
  const easyChoice = hasDifficulty(deck) && mode !== "daily";
  // What the deck (its easy cards when ticked) holds, for the length option.
  const pool = easyChoice && easyOnly ? deck.cards.filter(isEasy) : deck.cards;
  const capacity = deckCapacity(mode, options, names.length, pool);
  const capacityValue = capacity && options[capacity.option];
  const capacityText =
    capacity && typeof capacityValue === "number" && capacityValue > capacity.max
      ? capacityNote(mode, capacity, pool.length)
      : "";
  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = names.map((name) => name.trim().toLowerCase());
    if (new Set(trimmed.map((name, i) => name || `player ${i + 1}`)).size < names.length) {
      setProblem("Names must differ.");
      return;
    }
    let chosen = sessionOptions(mode, options);
    if (dropped.length > 0) {
      const kept = chosenSteps.filter((step) => !dropped.includes(step));
      if (kept.length === 0) {
        setProblem(`Previews play up to ${previewMs! / 1000} s. Choose a shorter step.`);
        return;
      }
      chosen = { ...chosen, steps: kept };
    }
    if (mode === "ladder" && chosenSteps.length === 0) {
      setProblem("Choose at least one step.");
      return;
    }
    if (mode !== "daily")
      try {
        normalizeOptions(mode, chosen);
      } catch (failure) {
        setProblem((failure as Error).message);
        return;
      }
    const need = cardsNeeded(mode, chosen, names.length);
    const easy = easyChoice && easyOnly;
    if ((easy ? deck.cards.filter(isEasy) : deck.cards).length < need) {
      setProblem(
        easy
          ? `Not enough easy cards: this game needs ${need}.`
          : `Deck too small: this game needs ${need} cards.`,
      );
      return;
    }
    setProblem("");
    onStart({
      mode,
      options: chosen,
      players: names.map((name, i) => ({ id: `p${i + 1}`, name: name.trim() || `Player ${i + 1}` })),
      source: scanPossible ? source : "draw",
      easyOnly: easy,
      kids: mode === "timeline" ? kids : mode === "eraSort" && chosen.kids === true,
    });
  }
  const fields = OPTION_FIELDS[mode].filter(
    (field) => (!field.when || field.when(options)) && (field.name !== "clipStart" || exact),
  );
  return (
    <form className="setup" onSubmit={submit} noValidate>
      <div className="deck-heading">
        <h1>{info.name}</h1>
        <p>{info.pitch}</p>
      </div>
      <div className="setup-grid">
        <fieldset className="panel setup-panel">
          <legend>{max === 1 ? "Player" : "Players"}</legend>
          {names.map((name, i) => (
            <div className="player-row" key={i}>
              <label htmlFor={`player-${i}`}>Player {i + 1} name</label>
              <div className="player-input">
                <input
                  id={`player-${i}`}
                  maxLength={40}
                  value={name}
                  onChange={(event) =>
                    setNames((list) => list.map((item, j) => (j === i ? event.target.value : item)))
                  }
                />
                {names.length > min ? (
                  <button
                    type="button"
                    aria-label={`Remove ${name.trim() || `Player ${i + 1}`}`}
                    onClick={() => setNames((list) => list.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          {names.length < max ? (
            <button type="button" onClick={() => setNames((list) => [...list, `Player ${list.length + 1}`])}>
              Add player
            </button>
          ) : null}
          <p className="muted">
            {min === max ? `${min} player` : `${min}–${max} players`}. Names stay on this device.
          </p>
        </fieldset>
        <fieldset className="panel setup-panel">
          <legend>Options</legend>
          {fields.map((field) => (
            <Fragment key={field.name}>
              <OptionControl
                mode={mode}
                field={field}
                options={options}
                note={capacity?.option === field.name ? capacityText : undefined}
                onChange={(value) => setOptions((current) => ({ ...current, [field.name]: value }))}
              />
              {field.name === "stakes" && options.stakes ? (
                <p className="muted">
                  Everyone starts with 5 chips; your score is your points plus the chips you hold.
                </p>
              ) : null}
            </Fragment>
          ))}
          {mode === "daily" ? <p className="muted">Today's cards are chosen from this deck.</p> : null}
          {mode === "timeline" ? (
            <label className="checkbox-label" htmlFor="option-kids-preset">
              <input
                id="option-kids-preset"
                type="checkbox"
                checked={kids}
                onChange={(event) => {
                  setKids(event.target.checked);
                  // The preset shows in the controls it sets.
                  if (event.target.checked)
                    setOptions((current) => ({ ...current, anchor: "beginning", challenges: false }));
                }}
              />
              Kids: start from the earliest songs, no challenges
            </label>
          ) : null}
          {mode === "timeline" && kids ? (
            <p className="muted">You can still change the options below.</p>
          ) : null}
          {dropped.length > 0 ? (
            <p className="muted" role="status">
              Previews play up to {previewMs! / 1000} s, so the{" "}
              {listNames(dropped.map((step) => `${step / 1000} s`))} step{dropped.length === 1 ? " is" : "s are"} left
              out.
            </p>
          ) : null}
          {easyChoice ? (
            <label className="checkbox-label" htmlFor="option-easy">
              <input
                id="option-easy"
                type="checkbox"
                checked={easyOnly}
                onChange={(event) => setEasyOnly(event.target.checked)}
              />
              Easy cards only
            </label>
          ) : null}
          {scanPossible ? (
            <fieldset className="field">
              <legend>Cards</legend>
              {(
                [
                  ["scan", "Scan printed cards"],
                  ["draw", "Draw from deck"],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="checkbox-label">
                  <input
                    type="radio"
                    name="card-source"
                    value={value}
                    checked={source === value}
                    onChange={() => setSource(value)}
                  />
                  {label}
                </label>
              ))}
              {source === "scan" ? <p className="muted">{SCAN_HINT}</p> : null}
            </fieldset>
          ) : null}
        </fieldset>
      </div>
      {warning ? <p className="warning">{warning}</p> : null}
      {problem || error ? (
        <p className="error" role="alert">
          {problem || error}
        </p>
      ) : null}
      <div className="action-row">
        <button className="primary" type="submit">
          Start
        </button>
        <button type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  );
}
