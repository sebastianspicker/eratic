# Eratic web companion

A standalone React + Vite + TypeScript deck editor and game host. The production build is a static site, and it runs without the Apple app, a backend or an account; Spotify and Apple Music playback are optional and need build-time configuration (`VITE_SPOTIFY_CLIENT_ID`, `VITE_MUSICKIT_DEVELOPER_TOKEN`; see the root README). Run these from the repository root:

```sh
npm --prefix apps/web ci
npm --prefix apps/web run dev     # or: make web-dev
npm --prefix apps/web test        # contract cases, core, storage, architecture rule, UI workflows (jsdom)
npm --prefix apps/web run build   # tsc --noEmit, then vite build into apps/web/dist
```

Serve `apps/web/dist` from any static HTTP host. `base: './'` allows deployment in a subdirectory ([Vite static deployment](https://vite.dev/guide/static-deploy.html)).

The npm dev, test, build and typecheck commands first run `scripts/generate-validators.mjs`: AJV compiles the four canonical schemas, then Vite bundles the validators and their runtime helpers into a generated ESM module. The browser never compiles schemas at runtime, so the production CSP can forbid dynamic code evaluation. Generated JavaScript is ignored; its TypeScript declarations are checked in. After editing a contract schema while the dev server is running, restart it or run `npm --prefix apps/web run generate:validators` to refresh validation. Direct `vite`, `vitest` or `tsc` invocations require generation first; prefer the npm/Makefile commands.

## GitHub Pages demo

`.github/workflows/pages.yml` tests and builds the static app, then deploys only `apps/web/dist` through GitHub Actions. The relative Vite base supports the repository subpath. The demo supplies no Spotify client ID, MusicKit developer token or Eratic card host; it uses the fictional sample deck and supports account-free editing and manual play. GitHub Pages must use GitHub Actions as its publishing source.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/core/deck.ts` | Deck types (v1 and v2), AJV check against `contract/deck-v1.schema.json` / `deck-v2.schema.json`, semantic validation, 8 MiB codec, sample deck, `updateGameYear` curation, `migrateDeck` |
| `src/core/cardUrls.ts` | The contract's safe-HTTPS and official-card URL rules, `qrPayload` route selection (incl. the Eratic card route) |
| `src/core/random.ts`, `eras.ts`, `scoring.ts`, `scan.ts` | Deterministic primitives, era lookup, scoring functions, provider track identity and scan resolution (`contract/game-rules.md` §1–3, §8) |
| `src/core/session.ts`, `src/core/game/` | Session-v1 files and the rules engine for all nine modes (§4–7) |
| `src/sessions.ts` | The current game session, its deck snapshot, Daily record and play preferences in `localStorage`, with quarantine of unreadable values |
| `src/playback/`, `src/scanner/` | Spotify (Web Playback SDK + Web API, PKCE), Apple Music (MusicKit JS), manual player, clip timing, calibration; camera QR scanning (`BarcodeDetector`, else jsQR) |
| `src/storage.ts` | `localStorage` persistence under `qr-song-quiz.deck.v1`; an unreadable saved value is quarantined under `qr-song-quiz.deck.v1.unreadable` and can be downloaded or discarded |
| `src/qrSvg.ts` | Black-on-white SVG QR codes with a four-module quiet zone and medium error correction |
| `src/ui/` | App shell with Deck and Play, card list, inspector (incl. game fields), QR preview, styles; `eras.ts` joins `contract/eras.json` with `design/eras.json`, and `Wordmark.tsx` draws the moving "era" plus "tic"; `game/` is the Play surface (home, setup, host screen, mode inputs registered in `modes/registry.ts`), loaded lazily |

`src/core` mirrors the Swift `EraticCore` and must not import React or browser APIs; `src/core/architecture.test.ts` enforces this. `src/core/contract.test.ts`, `primitives.contract.test.ts` and `game.contract.test.ts` run every file in `contract/cases/`. `src/ui/App.test.tsx` drives the real app in jsdom through the user workflows: sample, editing, QR routes, import/export, unreadable-data recovery.

## Behaviour notes

- Browser storage keeps imported and saved decks on one device and origin. It is not a backup; export JSON to transfer a deck to the Apple app.
- Storage errors show an actionable notice, and editing continues in memory.
- The default QR mode uses a supplied, recognized `officialCard.url`, labelled unverified. Direct provider links need an explicit opt-in.
- `index.html` carries a Content Security Policy that allows only the Spotify and Apple Music SDK origins; the dev server strips it. Confirm its host list in a real browser with providers connected.
- Provider scripts load only when the user connects a provider or requests an embedded preview; a scanned QR only selects a card in the loaded deck and never opens anything.
- All playback choices support QR/song links without sign-in or build credentials. Recognized song links also offer provider embeds on single-card stages: both play hidden with Play/Pause, Back 10 s, Restart and a position slider. Apple's preview file comes from the public iTunes Lookup API; songs without one fall back to an explicitly revealed Apple player. Previews do not provide exact timing. Spotify's loader runs in `public/spotify-preview.html` with its own CSP because it requires eval; the main page's policy stays eval-free. The bridge is trusted same-origin code, not a storage isolation boundary. *Use playback* reuses an existing Eratic authorization when configured; *Enable timed clips* explicitly requests provider authorization. Spotify Free and failed connections retain manual playback. Browser link handling may open the installed app, but the website cannot inherit its login. See [ADR 0014](../../docs/adr/0014-app-first-playback.md).

Design-idea attribution is kept in comments next to the code and in [docs/ATTRIBUTION.md](../../docs/ATTRIBUTION.md).
