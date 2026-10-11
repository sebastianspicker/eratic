# Product and interface design

## Purpose

Eratic helps someone turn a music collection into a curated, portable deck of timeline quiz cards. The editor emphasizes which recording is intended, why its answer year is correct, and what a QR will actually open. It is an independent project; the interface does not use Hitster branding or imply endorsement.

The product has two surfaces: **Deck**, which prepares decks, and **Play**, which hosts the nine [game modes](docs/game-modes.md) with a camera scanner and Spotify or Apple Music playback. A live playlist importer and a print designer are future surfaces, not hidden or disabled features.

The native Deck/Play selection is explicit state: starting or resuming a game keeps Play selected as its setup screen becomes the host screen.

## Platforms

Universal means **Mac, iPad, and iPhone**, using a shared native SwiftUI source tree. The web companion is independently usable in a browser. Both exchange the [same deck format](contract/README.md); visual components follow their platform rather than sharing rendered UI.

Mac and larger Apple screens use a native sidebar/detail workspace. iPhone uses the adaptive navigation behavior of `NavigationSplitView`. The web uses a list and inspector side by side above 720 CSS pixels and stacks them below that breakpoint. Maintain reading order and usable controls when the screen narrows.

## Deck interaction model

1. Open the fictional sample or import a JSON deck. Invalid imports show an error and preserve the current deck. If the web app finds a saved deck it can no longer read (for example after a validation rule changed), it opens the sample, keeps the unreadable data aside, and offers **Download unreadable saved data** or **Discard it** in the notice area; it never overwrites that data silently.
2. Choose a card by stable ID. The list shows its title, artist, and curated answer year as a chip in that year's era colour. Choosing a card is the signature moment: the inspector opens in the card's era and the year drops in.
3. Edit the answer year and its evidence/source, then explicitly save. A saved year in another decade re-themes the card at once. Apple also exposes the year note; web preserves notes through edits and export. Validation messages come from the shared core rules; Apple additionally asks for a whole-number year before validating.
4. Inspect a QR route. Official mode is the default and requires a supplied mapping. Its presence is always unverified, not a playback success state. Direct provider mode requires explicit selection and identifies its destination.
5. Export JSON to transfer or back up the deck. The Apple app holds edits in memory until export; the web stores imported and explicitly saved decks in browser local storage when available. Neither provides cross-device synchronization.

An official mapping does not prove that the curated song matches its catalogue entry. A valid provider URL does not prove regional availability. Keep these distinctions visible at the relevant action without filling the editor with implementation detail.

## Play interaction model

The rules are in [contract/game-rules.md](contract/game-rules.md); this section is how the apps present them. One **host** device runs the game for a room of players. Everything below applies to both apps; the platforms differ only in their native controls.

**Navigation.** Deck and Play are the two top-level destinations: a two-item navigation in the web header (with `aria-current`), a `TabView` on Apple. Switching never loses an in-progress game; it is saved after every action.

**Play home**, top to bottom:

1. **Resume** banner when a saved game is unfinished: mode, players and round, with *Resume* and *Discard* (which asks first). A reveal or final result the host hasn't seen yet is shown again on resume ("Results waiting"). Starting any new game, Daily included, asks before it replaces an unfinished one; an unfinished Daily for today offers *Resume today's round* instead. A resumed game always plays against the copy of the deck it started with.
2. **Playback**: Spotify, Apple Music and Play it yourself are always selectable. *Use playback* reuses existing Eratic authorization when available and otherwise enables QR/song-link playback without a sign-in prompt. Native Apple Music asks for system music permission and reads the device's subscription. Native song links prefer the installed music app, falling back to the website. Browser links use the app/browser's own signed-in account; a website cannot inherit a native app's authorization. *Enable timed clips* is an optional, separately labelled authorization action shown only when the integration is configured (Spotify on native; either provider on web). Failed connections fall back to manual playback. The status says "Spotify: manual playback (Free or Premium)" when subscription status is unknown, rather than claiming a detected Free account. Spotify Free playback remains subject to the provider's limits. With exact clips, a *Calibrate timing* button and the last result (ADR 0011); a failed or missing calibration shows a warning on Snippet Ladder, never a block. See [ADR 0014](docs/adr/0014-app-first-playback.md).
3. **Daily Eratic** card: today's status, streak (0 once a day is missed), and the share text once played. Daily always draws from the whole deck, ignoring *Easy cards only*, so everyone's day matches; it has no *Skip card*, because a skipped Daily card can't be replaced.
4. **Mode gallery**: nine tiles in the mode overview’s order. Each shows the name, the pitch, the player range, and, when the mode can't start, the reason in words: "Needs exact clips" (Snippet Ladder, Original or Imposter), "Needs linked recordings" (Original or Imposter without pairs), "Deck too small". Lineup without exact clips is offered as *Lineup by name*, where the tiles show titles instead of playing clips.

**Setup.** Players (or teams) as a list of name fields with *Add* and *Remove* within the mode's range, defaulting to "Player 1"…; names never leave the device. The mode's options with the contract defaults, in plain words. A **Kids** switch where supported (Timeline, Era Sort): Beginning anchor, no challenges, adjacent-era credit, larger controls, no timers. **Easy cards only** when the deck has difficulty values. **Card source**: *Scan printed cards* (when a camera exists) or *Draw from deck* (the default on Mac and web). *Start* creates the session with a random seed; Timeline and Relay anchors are picked with `pickAnchors` and announced: "Give Ada *Paper Satellites* (1984) as their first card."

**Host screen.** A top bar with the mode, the round ("Round 3 of 10", "First to 10 cards") and *End game* (asks first). A scoreboard strip with every player's score and, where used, chips, tokens or lives; the active player is marked in words ("Ada's turn"), not only by colour. The **card stage** in the middle:

- Before a card: *Draw card* or *Scan card*. A scan that resolves to a card already played warns and is ignored; a card from another deck names that deck; a provider link that isn't in the deck offers *Play audio only (not scored)*.
- With a card in play: a mystery card on the stage colour, *Play* / *Replay* ("Preparing…" while the provider loads the song), and a clip indicator that shows a playing dot and a countdown in text, so players who can't hear well can follow. Without exact clips the button says *Play on Spotify* (or Apple Music, after the link it will actually open) and opens the song in the provider's own app or site; a card without a link for that provider falls back to *Open song link*. Beside the mystery card, the link it would open is also shown as a QR code ("Scan with a phone to play the song there"), so a player can start the song on their own phone without the title appearing on the shared screen. A clip stops when the host leaves the host screen. *Skip card* (unavailable song) is a quiet secondary action. Clip start: the card's value, else the deck default, else the session choice; the host can nudge it by ±5 s for this card.
- **Inputs** for the mode (below). Guesses are entered one player at a time and shown as "Locked" until the reveal, so the host device can be passed around.
- **Embedded preview fallback** on a single-card stage: one *Play preview* loads the provider preview only when requested and starts it in a hidden player. The host then has *Play*/*Pause*, *Back 10 s*, *Restart* and a position slider with elapsed/total time, so they can stop, rewind or jump to another part without the song showing. Spotify's player stays concealed from view, focus and accessibility until *Show player (reveals song)*. Apple Music plays the song's public 30-second preview file directly, so it never needs revealing; when Apple lists no preview, the fallback is the revealed player (*Show Apple Music player (reveals song)*, *Hide player* keeps audio, *Stop preview* removes it). Loading, starting and Apple buffering have bounded waits. An error ends the attempt and retains retry/fallback controls; late provider events cannot restart it. Retry creates a fresh attempt, as does showing Spotify's player after an error. Opening Apple's revealed fallback disposes hidden playback first. QR and app links remain available. These previews have provider-controlled length and do not unlock exact-clip modes. Changing cards, revealing, leaving the stage or opening the external song removes the embed; native backgrounding also unloads it.
- **Reveal**: the signature moment. Keyboard focus moves to the reveal, and screen readers hear a one-line summary. The card's era takes over the stage (ground, pattern on the web, era label), the year drops in, then the title and artist, then each player's result ("+7, 1 year off"). *Next card* continues. Reduce Motion replaces the drop with a cut.

**Mode inputs**

| Mode | Inputs |
| --- | --- |
| Bullseye | A year field with −/+ steppers per player; after the reveal, a short era-coloured ruler with every guess and the answer, also listed as text |
| Era Sort | Nine era tiles in a 3×3 grid, each with its colours, name and decade ("Neon, 1980s"); the selected tile is outlined and says "Selected" |
| Timeline, Relay | A strip of era-coloured year chips with a slot button between and around them, labelled "Before 1984", "Between 1984 and 1997", "After 1997"; arrow keys move between slots and Enter places. Then challenges (each other player with tokens may claim a free slot), Name It as two host toggles (title right, artist right), and the wager. Relay shows lives as "Lives 2 of 3" and a "Voice: Ada" badge. Personal Timeline shows the active player's strip large and the others compact. |
| Higher or Lower | The reference card's chip on the left, the mystery card on the right, *Earlier* and *Later*, and the streak |
| Snippet Ladder | A step bar 1·5·10·30·60 with played steps filled and the current one lit; *Play 1 s*, then *Next: 5 s*; *Replay step*. A button per player to lock in at the current step (with a year field in Year and Both modes). A step counts as played only once its audio is audible. With Stakes, wagers come before the answer. When everyone has locked or the last step has played, *Show answer* gives the host the title, artist and year with Title and Artist toggles per locked player, then *Score card*. Space plays the next step. |
| Lineup | K tiles A–E, each with its own *Play* and playing state; each player orders them with *Move up* / *Move down* (drag is optional); the reveal shows the right order as era chips |
| Original or Imposter | *Play A* and *Play B*; each player picks A or B and may add a year; the reveal names the original and the relation |
| Daily Eratic | Solo: Era Sort tiles for rounds 1–3, a year field for 4–5, then the score, the share text with *Copy*, and the streak. A day already played shows its result instead. |

Sudden death replaces the inputs with a banner ("Sudden death: Ada and Lin") and the kind's inputs: a year each, an order of four cards, or "Who named it first?". Wagers (Stakes) are a 1–3 control per player, disabled with the reason at 0 chips.

During a web reveal, the round label names the round just played until the host advances. Bullseye ruler markers stay inside the visible ruler, including on phones; the textual guess/answer list remains authoritative.

**Results.** Standings with shared places shown as "=1", each player's score and the mode's tie-break numbers, then *Play again* (same players and options), *New game* and, on Apple, *Export session*. Daily adds the share text.

**Deck fields for games** (deck version 2). The card inspector gains an optional *Game* section: clip start (seconds), difficulty (1–5) and a related recording (another card plus *original of*, *cover of* or *remaster of*); the deck gets a default clip start. Saving the first such value converts the deck to format version 2 and says so once: "Saved as deck format 2; older Eratic versions can't open it."

## Brand: Eratic

**Name and voice.** *Eratic* is *era* plus *tic*. The bold "era" and light "tic" make the split readable before anyone sees a misspelling, and the tagline owns the joke: **Spelled wrong. Dated right.** The secondary line is *Every era has a move.* The tone is a clever party game: playful, never snobbish.

**Wordmark.** In the wordmark, "era" takes the style of the era currently on screen, while "tic" stays light and steady. The dot of the i is a QR finder square. The app icon is a lowercase *e* over nine decade bands. This file and `design/eras.json` define the maintained visual direction. The web favicon is `apps/web/public/favicon.svg`.

**Stage and spotlight.** The app chrome is a calm stage: dark *stage* `#17131C` for the header, warm *paper* `#F7F2E8` for the workspace, and white panels. Era colours appear only on era content: year chips, the inspector hero, the wordmark's "era" and, later, the answer side of printed cards. QR codes are always black on white with a four-module quiet zone, and no era colour or pattern ever touches them.

### The nine eras

[`design/eras.json`](design/eras.json) is the single source of truth, read by `apps/web/src/ui/eras.ts` and bundled into the Apple app (`Sources/Era.swift`). A card's curated year picks its era. This is presentation only and never changes deck data.

| Era | Years | Look | Type move |
| --- | --- | --- | --- |
| Shellac | before 1950 | Sepia paper, deco fan lines | Narrow capitals, wide tracking |
| Jukebox | 1950s | Cream, navy, cherry polka dots | Heavy |
| Mod | 1960s | Off-white, black, orange target roundel | Narrow, heavy, tight |
| Disco | 1970s | Plum ground, amber sunset bands | Full width, bold |
| Neon | 1980s | Midnight, magenta and cyan laser grid | Heavy capitals with glow |
| Zine | 1990s | Photocopy grey, black and blue halftone | Narrow capitals, knocked 2° off straight |
| Chrome | 2000s | Ice blue, brushed-metal lines, aqua pill | Slightly narrow, semibold |
| Pastel | 2010s | Blush, flat circles, raspberry | Light, lowercase |
| Now | 2020s and later | Black, acid-lime dot grid | Heavy, lowercase, tight |

Patterns are made only of stripes, dots and rings, which are CSS gradients on the web (`eras.ts`), kept in step with the token colours by hand. Apple currently carries an era's ground, colours and type move but not its pattern. Control borders are `#8A8072` on white or paper and `#7A7085` on the stage, which keeps them above 3:1.

**Type.** On the web, everything is set in one variable family, Bricolage Grotesque, bundled locally (see [attribution](docs/ATTRIBUTION.md)). Each era moves along its width (75–100%) and weight (300–800) axes. Apple uses the system font with matching width (compressed, condensed, standard) and weight. Don't force web pixel values into native layouts; keep the meaning consistent instead.

**Contrast.** `apps/web/src/ui/eras.test.ts` enforces every era pair; `EraticCore`'s `EraTokensTests` checks the token format and era boundaries on Apple:

- text on an era ground: at least 7:1;
- the accent year on its ground: at least 3:1 (display size);
- text on an accent fill: at least 4.5:1;
- an era's glow on the stage: at least 4.5:1.

**Motion.** The year and the wordmark's "era" drop in with a short overshoot whenever they change. When a saved year moves a card into another era, the inspector's ground and text cross-fade over 0.45 s. Under *reduce motion* (the web media query, or Apple's `accessibilityReduceMotion`) everything appears without animation.

### Web layout

The implementation is [styles.css](apps/web/src/ui/styles.css):

- **Width and columns:** maximum width 1504 px. Above 720 px, the card list and inspector sit side by side, split 42/58; below 720 px they stack.
- **Panels and controls:** panels are white with a 16 px radius. Controls are pills at least 44 px tall. The primary action is a stage-coloured fill.
- **Focus:** a 3 px outline in `#2F3BD9` on paper, `#8A90FF` on the stage.
- **Inspector hero:** a 56 px pattern band, then the era label, the year at 112 px (84 px on phones), the title and the artist.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| App/workspace shell | Deck lifetime, import/export, current card, global error feedback |
| Card list | Ordered selection with stable identity and concise metadata |
| Card inspector/detail | Draft year/source edits, explicit save, selected recording context |
| QR preview | Explicit route choice, exact payload, readable empty state and unverified-mapping label |
| Play home and setup | Provider connection and tier, calibration, mode availability, players, options, card source |
| Host screen | One session: drawing or scanning, clip playback, inputs, reveal, scoreboard, results |
| Playback and scanner services | Provider adapters, clip timing, calibration, camera decoding; no game rules |
| Core/contract layer | Data validity, route selection, scan resolution and every game rule, independent of visual layout |

Keep text and controls rendered by the platform. Generated concept images are design references, not the shipped UI. Fictional sample records must stay clearly identified. Avoid inactive buttons suggesting unsupported playlist fetch or printing; when a game feature can't run (no camera, no exact clips), say why in words.

## Accessibility and QR output

Every input needs a label; selected state must be discernible beyond color; keyboard focus must remain visible. Web errors use alert/status semantics. Long titles and URLs should wrap without horizontal overflow. Use native accessibility and text scaling on Apple; real-device VoiceOver and Dynamic Type testing remain to be completed.

QR output is black on white, with a four-module quiet zone. Preserve the complete payload, avoid overlays or decorative modules, and use a sharp representation. The web renders SVG; Apple uses Core Image. Physical scan reliability and printed dimensions still require real card tests when print output is added.

## Planned playlist and print flow

Follow the [playlist design](docs/playlist-import.md): Spotify or Apple Music input, review candidates, resolve recording/year issues, then create curated cards. Import progress and partial failures belong to this future flow. Preserve user corrections on re-import.

The print surface should add card size, page size, margins, duplex edge, trim marks, and a one-sheet alignment preview before a full export. It should share one ordered manifest for both sides. These are planned controls, not implemented settings.

## Visual verification

The Eratic look is defined on the brand board. Era behaviour is covered by jsdom workflow tests and token contrast tests. On 2026-10-11, Chrome exercised Play home, Bullseye setup, locked answers, reload/resume, reveal and standings at 1440×1000 and 390×844 against both production and development builds, with no console errors or page-wide horizontal overflow. The native Mac app's Deck, Play home, Bullseye setup, host and reveal were inspected with screenshots and accessibility state; starting a game now keeps Play selected. A subsequent production Chrome pass covered Timeline, Era Sort, Higher or Lower, Relay, Lineup by name and Daily Eratic through final results at both viewport sizes, including timeline/era keyboard selection, reorder buttons and reveal focus, with Reduce Motion enabled and no console errors or horizontal overflow. Embedded previews subsequently passed six production Chrome scenarios (manual Spotify, selected Spotify and Apple Music × desktop/phone), with signed-out audio, concealed metadata, stop/replay and reveal cleanup. Exact-clip modes, iPhone/iPad rendering (simulator checks skipped at the user's request), physical-device, VoiceOver, Dynamic Type, and printed-QR checks are still open; [status](docs/STATUS.md) tracks verification.
