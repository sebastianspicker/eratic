import { useState } from "react";
import { pendingInputs } from "../../../core/game/engine";
import { dailyRoundKind } from "../../../core/scoring";
import type { DailyOptions } from "../../../core/session";
import { loadDaily } from "../../../sessions";
import { deltas, signed } from "../history";
import { YearEntry } from "./Bullseye";
import { EraEntry, eraPickText } from "./EraSort";
import { LockedEntry, send } from "./LockedEntry";
import type { ModeInputProps, ModeUI } from "./types";

// The share text with Copy; clipboard failures are reported, never thrown.
export function ShareText({ text }: { text: string }) {
  const [status, setStatus] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Copied.");
    } catch {
      setStatus("Couldn't copy. Select the text instead.");
    }
  }
  return (
    <div className="share">
      <p className="share-text">{text}</p>
      <button onClick={() => void copy()}>Copy</button>
      <span className="save-status" role="status">
        {status}
      </span>
    </div>
  );
}

// Solo: Era Sort tiles for rounds 1-3, a year for rounds 4-5.
function DailyInput({ controller, state }: ModeInputProps) {
  const round = state.round + 1;
  const total = (state.options as DailyOptions).cards.length;
  const eraRound = dailyRoundKind(round) === "eraSort";
  return (
    <div className="daily-input">
      <p className="round-note">
        Round {round} of {total}: {eraRound ? "which era?" : "which year?"}
      </p>
      <LockedEntry players={state.players} pending={pendingInputs(state)}>
        {(player) =>
          eraRound ? (
            <EraEntry
              heading="Your era"
              onLock={(era) => send(controller, { type: "pickEra", playerId: player.id, era })}
            />
          ) : (
            <YearEntry
              id={`daily-${player.id}`}
              heading="Your year"
              onLock={(year) => send(controller, { type: "guess", playerId: player.id, year })}
            />
          )
        }
      </LockedEntry>
    </div>
  );
}

export const dailyUI: ModeUI = {
  Input: DailyInput,
  resultLines: (info) =>
    info.inputs.flatMap((action) => {
      if (action.type === "pickEra")
        return [{ playerId: action.playerId, text: eraPickText(info, action.playerId, action.era) }];
      if (action.type === "guess")
        return [
          {
            playerId: action.playerId,
            text: `${signed(deltas(info, action.playerId).points)} (guessed ${action.year})`,
          },
        ];
      return [];
    }),
  tieBreaks: (summary) => [`out of ${summary.maxScore ?? 0}`],
  ResultsExtra: ({ summary }) => {
    const record = loadDaily();
    return (
      <div className="daily-result">
        {summary.shareText ? <ShareText text={summary.shareText} /> : null}
        {record ? (
          <p>
            Streak: {record.streak} day{record.streak === 1 ? "" : "s"}
          </p>
        ) : null}
      </div>
    );
  },
};
