import { useState } from "react";
import type { Deck } from "../../core/deck";
import type { GameMode } from "../../core/session";
import type { PlaybackHub } from "../../playback/hub";
import { exactClips } from "../../playback/player";
import { Host } from "./Host";
import { calibrationWarning } from "./modes/Ladder";
import { useHub } from "./playback";
import { PlayHome } from "./PlayHome";
import { Setup } from "./Setup";
import { useGame, type GameController } from "./useGame";

const cameraAvailable = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";
const REPLACE_SAVED = "Starting replaces the unfinished saved game.";

// The Play surface: home, setup, then the host screen while a game is open.
export function Play({
  controller,
  deck,
  hub,
  notice,
  onDismissNotice,
}: {
  controller: GameController;
  deck: Deck;
  hub: PlaybackHub;
  notice: string;
  onDismissNotice?: () => void;
}) {
  const view = useGame(controller);
  const hubState = useHub(hub);
  const [setup, setSetup] = useState<GameMode>();
  // The host already agreed to replace the saved game (from Play today's round).
  const [agreed, setAgreed] = useState(false);
  const hasCamera = cameraAvailable();
  if (view.session && view.state && view.summary)
    return (
      <Host
        key={`${view.session.id}:${view.run}`}
        controller={controller}
        view={view}
        deck={controller.deckFor(deck)}
        hub={hub}
        hasCamera={hasCamera}
      />
    );
  if (setup)
    return (
      <Setup
        key={setup}
        mode={setup}
        deck={deck}
        hasCamera={hasCamera}
        error={view.notice}
        previewMs={hubState.tier?.kind === "previewOnly" ? hubState.tier.maxMs : undefined}
        warning={
          setup === "ladder"
            ? calibrationWarning(hubState.provider, Boolean(hubState.tier && exactClips(hubState.tier)))
            : ""
        }
        onBack={() => {
          controller.setNotice("");
          setAgreed(false);
          setSetup(undefined);
        }}
        onStart={(chosen) => {
          if (view.saved && !agreed && !window.confirm(REPLACE_SAVED)) return;
          if (controller.start(chosen, deck)) {
            setAgreed(false);
            setSetup(undefined);
          }
        }}
      />
    );
  return (
    <PlayHome
      controller={controller}
      view={view}
      deck={deck}
      hub={hub}
      notice={notice}
      onDismissNotice={onDismissNotice}
      onChoose={(mode) => {
        controller.setNotice("");
        setSetup(mode);
      }}
      onDaily={() => {
        if (view.saved && !window.confirm(REPLACE_SAVED)) return;
        controller.setNotice("");
        setAgreed(view.saved !== undefined);
        setSetup("daily");
      }}
    />
  );
}
