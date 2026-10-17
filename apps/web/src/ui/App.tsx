import { Component, lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  decodeDeckBytes,
  exportDeck,
  MAX_DECK_BYTES,
  updateGameYear,
  type Deck,
} from "../core/deck";
import { record, withCause } from "../diagnostics";
import { PlaybackHub } from "../playback/hub";
import { completeSpotifyLogin } from "../playback/spotifyAuth";
import {
  discardUnreadable,
  loadDeck,
  persistDeck,
  readUnreadable,
  UnreadableSlotError,
} from "../storage";
import { BuildFooter } from "./BuildFooter";
import { CardList } from "./CardList";
import { MIGRATION_NOTICE, DeckGameFields, withCardGameFields, withCardRelation, withDeckClipStart } from "./CardGameFields";
import { LinkSuggestions } from "./LinkSuggestions";
import { CardInspector } from "./CardInspector";
import { saveText } from "./download";
import { eraFor } from "./eras";
import { GameController } from "./game/useGame";
import { Wordmark } from "./Wordmark";

// The Play surface loads on first use (and is fetched once the app is idle), so
// the main chunk stays small; the game itself lives in GameController.
const loadPlay = () => import("./game/Play");
const Play = lazy(() => loadPlay().then((module) => ({ default: module.Play })));

// A failed chunk load (offline, a deploy in between) says so instead of a blank page.
class PlayBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice" role="alert">
        <p>Couldn't load the game. Check your connection and reload.</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}

export default function App() {
  const [initial] = useState(loadDeck);
  const [deck, setDeck] = useState(initial.deck);
  const [importRevision, setImportRevision] = useState(0);
  const [selectedID, setSelectedID] = useState(initial.deck.cards[0].id);
  const [notice, setNotice] = useState(initial.notice);
  const [persisted, setPersisted] = useState(initial.persisted);
  // The deck holds changes that storage refused, so they exist only in this page.
  const [unstored, setUnstored] = useState(false);
  const [unreadable, setUnreadable] = useState(initial.unreadable);
  const fileInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<"deck" | "play">("deck");
  const [hub] = useState(() => new PlaybackHub());
  const [game] = useState(() => new GameController());
  const [playNotice, setPlayNotice] = useState("");
  useEffect(() => {
    void loadPlay().catch(() => {
      // retried when Play opens
    });
  }, []);
  // Returning from Spotify sign-in: finish it, connect, and open Play.
  useEffect(() => {
    let href: string;
    try {
      href = location.href;
    } catch {
      return;
    }
    completeSpotifyLogin(href)
      .then((signedIn) => {
        if (!signedIn) return;
        setView("play");
        void hub.connect("spotify");
      })
      .catch((failure: unknown) => {
        setView("play");
        setPlayNotice(failure instanceof Error ? failure.message : "Spotify sign-in failed.");
      });
  }, [hub]);
  const selected =
    deck.cards.find((card) => card.id === selectedID) ?? deck.cards[0];
  // message is shown after a successful save (the deck format 2 notice).
  // False when the deck changed in memory but could not be stored.
  function installDeck(next: Deck, message = ""): boolean {
    let stored = true;
    try {
      persistDeck(next);
      setPersisted(true);
      setUnstored(false);
      setNotice(message);
    } catch (failure) {
      stored = false;
      setPersisted(false);
      setUnstored(true);
      const problem =
        failure instanceof UnreadableSlotError
          ? failure.message
          : "Browser storage is unavailable. Export your deck to keep your changes.";
      record("deck", withCause(problem, failure));
      setNotice([problem, message].filter(Boolean).join(" "));
    }
    setDeck(next);
    return stored;
  }
  // Deck format 2 fields: validated by the core; throws its message on failure.
  function saveV2({ deck: next, migrated }: { deck: Deck; migrated: boolean }): boolean {
    return installDeck(next, migrated ? MIGRATION_NOTICE : "");
  }
  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > MAX_DECK_BYTES)
        throw new Error("Deck file is too large. Maximum size is 8 MiB.");
      const next = decodeDeckBytes(new Uint8Array(await file.arrayBuffer()));
      const question = unstored
        ? `Replace the current deck and its unsaved changes with “${next.title}”? Export the current deck first to keep them.`
        : persisted
          ? `Replace the deck stored on this device with “${next.title}”? Export the current deck first to keep a copy.`
          : "";
      if (question && !window.confirm(question)) return;
      installDeck(next);
      setSelectedID(next.cards[0].id);
      setImportRevision((value) => value + 1);
    } catch (failure) {
      const problem = failure instanceof Error ? failure.message : "Could not import deck.";
      record("deck", `Import failed: ${problem}`);
      setNotice(problem);
    }
  }
  function downloadDeck() {
    try {
      saveText(`${deck.id}.json`, exportDeck(deck));
    } catch (failure) {
      const problem = failure instanceof Error ? failure.message : "Could not export deck.";
      record("deck", `Export failed: ${problem}`);
      setNotice(problem);
    }
  }
  function downloadUnreadable() {
    const raw = readUnreadable();
    if (raw === null) setUnreadable(false);
    else saveText("eratic-unreadable-deck.json", raw);
  }
  function discard() {
    try {
      discardUnreadable();
      setUnreadable(false);
    } catch {
      setNotice("Browser storage is unavailable. Could not discard the data.");
    }
  }
  return (
    <>
      <header className="app-header">
        <Wordmark era={eraFor(selected.gameYear.value)} />
        <nav className="app-nav" aria-label="Main">
          {(
            [
              ["deck", "Deck"],
              ["play", "Play"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              className="nav-item"
              aria-current={view === value ? "page" : undefined}
              onClick={() => setView(value)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="header-actions" hidden={view !== "deck"}>
          <button onClick={() => fileInput.current?.click()}>
            Import JSON
          </button>
          <button className="primary" onClick={downloadDeck}>
            Export deck
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(event) => {
              void importFile(event);
            }}
          />
        </div>
      </header>
      {view === "play" ? (
        <main>
          <PlayBoundary>
            <Suspense fallback={<p role="status">Loading Play…</p>}>
              <Play
                controller={game}
                deck={deck}
                hub={hub}
                notice={playNotice}
                onDismissNotice={() => setPlayNotice("")}
              />
            </Suspense>
          </PlayBoundary>
        </main>
      ) : (
        <main>
          <div className="deck-heading">
            <h1>{deck.title}</h1>
            <p>
              {deck.cards.length} cards ·{" "}
              {persisted
                ? "Stored on this device"
                : "Sample deck · Import or save to keep changes"}
            </p>
            <DeckGameFields
              key={`${deck.id}/${importRevision}`}
              deck={deck}
              onSave={(seconds) => saveV2(withDeckClipStart(deck, seconds))}
            />
          </div>
          {notice || unreadable ? (
            <div className="notice" role="alert">
              {notice ? <p>{notice}</p> : null}
              {unreadable ? (
                <p>
                  <button onClick={downloadUnreadable}>
                    Download unreadable saved data
                  </button>{" "}
                  <button onClick={discard}>Discard it</button>
                </p>
              ) : null}
            </div>
          ) : null}
          <LinkSuggestions
            deck={deck}
            onLink={(item) => {
              saveV2(withCardRelation(deck, item.cardId, { cardId: item.relatedTo, relation: item.relation }));
              // The inspector's Game section re-reads the saved relation by itself.
            }}
          />
          <div className="workspace">
            <CardList
              deck={deck}
              selectedID={selected.id}
              onSelect={setSelectedID}
            />
            <CardInspector
              key={`${deck.id}/${selected.id}/${importRevision}`}
              card={selected}
              deck={deck}
              onSaveGame={(values) => saveV2(withCardGameFields(deck, selected.id, values))}
              onSave={(value, source) =>
                installDeck(
                  updateGameYear(deck, selected.id, {
                    ...selected.gameYear,
                    value,
                    source,
                  }),
                )
              }
            />
          </div>
        </main>
      )}
      <BuildFooter />
    </>
  );
}
