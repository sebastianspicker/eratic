import { useState } from "react";
import { pendingInputs } from "../../../core/game/engine";
import { eraFor, eraStyle, ERAS } from "../../eras";
import { chipsText, deltas, inputsSinceDraw, playerName, signed, yearsOff, type RevealInfo } from "../history";
import { AllAtOnceForm, EntryForm, LockedEntry, send } from "./LockedEntry";
import type { ModeInputProps, ModeUI } from "./types";
import { parseYear, YearField } from "./YearField";

// Contract section 5.4: a Bullseye wager wins within 3 years.
const WAGER_RULE = "Win the wager if your guess is within 3 years.";

// A year entry for one player; with held set, the player also wagers.
export function YearEntry({
  id,
  heading,
  held,
  playerName,
  onLock,
}: {
  id: string;
  heading: string;
  held?: number;
  playerName?: string;
  onLock: (year: number, wager: number | undefined) => string;
}) {
  const [value, setValue] = useState("");
  return (
    <EntryForm
      heading={heading}
      held={held}
      playerName={playerName}
      wagerRule={WAGER_RULE}
      onLock={(wager) => {
        const year = parseYear(value);
        return year === undefined ? "Enter a year from 1850 to 2100." : onLock(year, wager);
      }}
    >
      <YearField id={id} label="Year" value={value} onChange={setValue} />
    </EntryForm>
  );
}

function BullseyeInput({ controller, session, state }: ModeInputProps) {
  const guessed = new Set(
    inputsSinceDraw(session.actions).flatMap((action) =>
      action.type === "guess" ? [action.playerId] : [],
    ),
  );
  return (
    <LockedEntry
      players={state.players}
      pending={pendingInputs(state)}
      allAtOnce={
        <AllAtOnceForm<string>
          heading="Everyone's guesses"
          controller={controller}
          players={state.players}
          pending={pendingInputs(state)}
          initial=""
          wagerRule={WAGER_RULE}
          held={(player) => (state.chips && !Object.hasOwn(state.wagers, player.id) ? state.chips[player.id] : undefined)}
          field={(player, value, onChange) => (
            <YearField id={`guess-all-${player.id}`} label={`${player.name}'s year`} value={value} onChange={onChange} />
          )}
          build={(player, value, wager) => {
            const year = parseYear(value);
            if (year === undefined) return "Enter a year from 1850 to 2100.";
            return [
              ...(wager !== undefined ? [{ type: "wager" as const, playerId: player.id, chips: wager }] : []),
              ...(guessed.has(player.id) ? [] : [{ type: "guess" as const, playerId: player.id, year }]),
            ];
          }}
        />
      }
    >
      {(player) => (
        <YearEntry
          id={`guess-${player.id}`}
          heading={`${player.name}'s guess`}
          playerName={player.name}
          held={state.chips && !Object.hasOwn(state.wagers, player.id) ? state.chips[player.id] : undefined}
          onLock={(year, wager) =>
            send(
              controller,
              ...(wager !== undefined ? [{ type: "wager" as const, playerId: player.id, chips: wager }] : []),
              ...(guessed.has(player.id) ? [] : [{ type: "guess" as const, playerId: player.id, year }]),
            )
          }
        />
      )}
    </LockedEntry>
  );
}

const guesses = (info: RevealInfo) =>
  info.inputs.flatMap((action) =>
    action.type === "guess" ? [{ id: action.playerId, year: action.year }] : [],
  );
const offBy = (info: RevealInfo, id: string) =>
  (info.after.distance?.[id] ?? 0) - (info.before.distance?.[id] ?? 0);

const ROW = 34; // px between stacked ruler markers (30px marker plus a gap)
// After the reveal: an era-coloured ruler with every guess and the answer, also as text.
function BullseyeRuler({ info, session }: { info: RevealInfo; session: ModeInputProps["session"] }) {
  const answer = info.cards[0].year;
  const marks = guesses(info);
  const low = Math.min(answer, ...marks.map((mark) => mark.year)) - 2;
  const high = Math.max(answer, ...marks.map((mark) => mark.year)) + 2;
  const span = high - low + 1;
  // Markers carry the player's 1-based number in session order, so "Ada" and "Anna" never collide.
  const numberOf = (id: string) => session.players.findIndex((player) => player.id === id) + 1;
  // Keep the full 30px marker visible at the ends of a narrow ruler.
  // Guesses of the same year stack in rows so every number stays visible.
  const rows = new Map<string, number>();
  const seen = new Map<number, number>();
  for (const mark of marks) {
    const row = seen.get(mark.year) ?? 0;
    rows.set(mark.id, row);
    seen.set(mark.year, row + 1);
  }
  const rowOf = (id: string) => rows.get(id) ?? 0;
  const deepest = Math.max(0, ...rows.values());
  const at = (year: number) => `clamp(16px, ${((year - low + 0.5) / span) * 100}%, calc(100% - 16px))`;
  return (
    <div className="ruler-block">
      <div className="ruler" aria-hidden="true" style={{ height: 48 + deepest * ROW }}>
        {ERAS.map((era) => {
          const from = Math.max(low, era.from ?? low);
          const to = Math.min(high, era.to ?? high);
          if (from > to) return null;
          return (
            <span
              key={era.id}
              className="ruler-era"
              style={{
                ...eraStyle(era),
                left: `${((from - low) / span) * 100}%`,
                width: `${((to - from + 1) / span) * 100}%`,
              }}
              title={era.name}
            />
          );
        })}
        <span className="ruler-mark answer" style={{ ...eraStyle(eraFor(answer)), left: at(answer) }}>
          ★
        </span>
        {marks.map((mark) => (
          <span key={mark.id} className="ruler-mark" style={{ left: at(mark.year), top: 8 + rowOf(mark.id) * ROW }}>
            {numberOf(mark.id)}
          </span>
        ))}
      </div>
      <ul className="ruler-list">
        <li>
          <strong>Answer: {answer}</strong>
        </li>
        {marks.map((mark) => (
          <li key={mark.id}>
            {numberOf(mark.id)} · {playerName(session, mark.id)}: {mark.year} ({yearsOff(offBy(info, mark.id))})
          </li>
        ))}
      </ul>
    </div>
  );
}

export const bullseyeUI: ModeUI = {
  Input: BullseyeInput,
  resultLines: (info) =>
    guesses(info).map(({ id, year }) => {
      const { points, chips } = deltas(info, id);
      return { playerId: id, text: `${signed(points)}, ${yearsOff(offBy(info, id))} (guessed ${year})${chipsText(chips)}` };
    }),
  RevealExtra: BullseyeRuler,
  tieBreaks: (summary, id) => [
    `${summary.exact?.[id] ?? 0} exact`,
    `${summary.distance?.[id] ?? 0} years off in total`,
  ],
};
