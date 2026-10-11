import { useRef, useState, type KeyboardEvent } from "react";
import { pendingInputs } from "../../../core/game/engine";
import { eraName } from "../../../core/eras";
import { ERAS, eraStyle } from "../../eras";
import { deltas, signed, type RevealInfo } from "../history";
import { EntryForm, LockedEntry, send } from "./LockedEntry";
import type { ModeInputProps, ModeUI } from "./types";

const MOVES: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 };

// Nine era tiles in a 3x3 grid; arrow keys move between them.
export function EraGrid({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (era: string) => void;
}) {
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = ERAS.findIndex((era) => era.id === value);
  function move(event: KeyboardEvent, index: number) {
    const by = MOVES[event.key];
    if (by === undefined) return;
    event.preventDefault();
    const next = index + by;
    if (next < 0 || next >= ERAS.length) return;
    onChange(ERAS[next].id);
    tiles.current[next]?.focus();
  }
  return (
    <div className="era-grid" role="radiogroup" aria-label={label}>
      {ERAS.map((era, index) => {
        const isSelected = era.id === value;
        return (
          <button
            key={era.id}
            ref={(element) => {
              tiles.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={`${era.name}, ${era.label}`}
            tabIndex={index === (selected < 0 ? 0 : selected) ? 0 : -1}
            className={`era-tile${isSelected ? " selected" : ""}`}
            style={eraStyle(era)}
            data-era={era.id}
            onClick={() => onChange(era.id)}
            onKeyDown={(event) => move(event, index)}
          >
            <span className="era-tile-motif" aria-hidden="true" />
            <span className="era-tile-name">{era.name}</span>
            <span className="era-tile-label">{era.label}</span>
            {isSelected ? <span className="era-tile-selected">Selected</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function EraEntry({
  heading,
  onLock,
}: {
  heading: string;
  onLock: (era: string) => string;
}) {
  const [era, setEra] = useState<string>();
  return (
    <EntryForm heading={heading} onLock={() => (era ? onLock(era) : "Pick an era.")}>
      <EraGrid label={heading} value={era} onChange={setEra} />
    </EntryForm>
  );
}

function EraSortInput({ controller, state }: ModeInputProps) {
  return (
    <LockedEntry players={state.players} pending={pendingInputs(state)}>
      {(player) => (
        <EraEntry
          heading={`${player.name}'s era`}
          onLock={(era) => send(controller, { type: "pickEra", playerId: player.id, era })}
        />
      )}
    </LockedEntry>
  );
}

// Words only: the points come from the engine's summary.
export function eraPickText(info: RevealInfo, id: string, era: string): string {
  const { points } = deltas(info, id);
  const how = era === info.cards[0].era ? "right era" : points > 0 ? "neighbouring era" : "missed";
  return `${signed(points)}, ${how} (picked ${eraName(era)})`;
}

export const eraSortUI: ModeUI = {
  Input: EraSortInput,
  resultLines: (info) =>
    info.inputs.flatMap((action) =>
      action.type === "pickEra"
        ? [{ playerId: action.playerId, text: eraPickText(info, action.playerId, action.era) }]
        : [],
    ),
  tieBreaks: (summary, id) => [`${summary.rightEras?.[id] ?? 0} right eras`],
};
