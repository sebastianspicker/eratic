import type { ComponentType } from "react";
import type { Deck } from "../../../core/deck";
import type { GameState } from "../../../core/game/engine";
import type { CardRef, Session } from "../../../core/session";
import type { RevealInfo } from "../history";
import type { PlaybackProps } from "../playback";
import type { GameController, Summary } from "../useGame";

// What a mode supplies to the shared host screen. The host owns drawing,
// playback, the reveal stage, scoreboard and results; a mode adds its inputs and
// the words for its results.
export interface ModeInputProps {
  controller: GameController;
  session: Session;
  state: GameState;
  summary: Summary;
  deck: Deck;
  playback: PlaybackProps;
  // Stops the clip and reveals; for modes that reveal from their own inputs.
  reveal: () => void;
}
export interface ResultLine {
  playerId: string;
  text: string;
}
export interface ModeUI {
  Input: ComponentType<ModeInputProps>;
  // Replaces the default one-card stage (several cards, clip steps).
  Stage?: ComponentType<ModeInputProps>;
  // The mode's inputs end with their own reveal button.
  ownReveal?: boolean;
  // The card whose era takes over the reveal; none shows the reveal without a hero.
  heroCard?(info: RevealInfo, session: Session): CardRef | undefined;
  // One line per player who took part in the revealed card.
  resultLines(info: RevealInfo, session: Session): ResultLine[];
  RevealExtra?: ComponentType<{ info: RevealInfo; session: Session; deck: Deck }>;
  // The mode's tie-break numbers for the results, in words.
  tieBreaks?(summary: Summary, playerId: string): string[];
  ResultsExtra?: ComponentType<{ session: Session; summary: Summary }>;
}
