import type { GameMode } from "../../../core/session";
import { bullseyeUI } from "./Bullseye";
import { dailyUI } from "./Daily";
import { eraSortUI } from "./EraSort";
import { higherLowerUI } from "./HigherLower";
import { imposterUI } from "./Imposter";
import { ladderUI } from "./Ladder";
import { lineupUI } from "./Lineup";
import { relayUI } from "./Relay";
import { timelineUI } from "./Timeline";
import type { ModeUI } from "./types";

// The host screen's part of each mode: its inputs, stage and result words.
export const MODE_UI: Record<GameMode, ModeUI> = {
  ladder: ladderUI,
  timeline: timelineUI,
  bullseye: bullseyeUI,
  eraSort: eraSortUI,
  higherLower: higherLowerUI,
  relay: relayUI,
  lineup: lineupUI,
  daily: dailyUI,
  imposter: imposterUI,
};
