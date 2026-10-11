# ADR 0014 App-first playback without required sign-in

Date: 2026-10-11. Status: implemented within the platform limits below; requested by the user. Amends the provider setup and authorization behavior in [ADR 0011](0011-game-rules-contract-and-sessions.md).

## Context

Players should use the music accounts already available on their devices. Developer registration and subscription detection must not prevent selecting Spotify or Apple Music. Spotify Premium being unavailable must leave a playable fallback.

A static comparison with HITSTER Android 4.0.3 found separate Spotify App Remote and embedded-preview paths, with fallback when premium capability is lost. Its Apple Music web authorization explicitly signs out first to support switching accounts. These are platform-specific observations, not evidence that a website can inherit a native app's login. No implementation or identifiers were copied; private artifacts remain excluded from the repository.

## Decision

- Always offer Spotify, Apple Music and manual playback. Missing integration configuration enables QR/song-link playback rather than disabling a provider.
- Reuse existing Eratic authorization automatically. Native MusicKit reads the system subscription after music permission; web MusicKit reuses its authorized instance without forcing reauthorization. Spotify reuses stored tokens and may refresh them without initiating interactive sign-in.
- Make interactive authorization for timed clips a separate action. Developer client IDs/tokens belong to the application build, never to a player's setup form.
- When connecting fails, clear any stale exact-playback tier and retain the selected provider for manual QR/link routing. Do not label an unknown account as Spotify Free. Free playback follows Spotify's own playback limits.
- Native Spotify links try the Spotify app first; native macOS Apple Music links use Music when installed. Missing/unopenable apps fall back to the original HTTPS URL. Browser links rely on the platform's normal link handling.
- Retain Web API control on native and Web Playback SDK control on web for authorized Spotify Premium playback. Opening the Spotify app does not grant Eratic permission to control it. No Spotify App Remote SDK is added. Account-free embedded previews are a separate fallback in both apps, outside the exact-clip adapter contract.

## Consequences and limits

The unconfigured build can open songs in the selected provider, display QR codes and load provider embeds without credentials. On a single-card stage, one *Play preview* request loads the provider preview hidden and starts it; the host controls it with Play/Pause, Back 10 s, Restart and a position slider. Recognized Spotify links use the public iframe API (`play`, `pause`, `resume`, `restart`, `seek`); song details stay concealed unless the host reveals the player. Recognized Apple Music links look up the song's 30-second preview file through Apple's public iTunes Lookup API (song ID and storefront only; every field except the preview URL is discarded) and play it in an audio element or `AVPlayer`, so the song never has to be shown. When Apple lists no preview, the standard interactive embed remains as an explicitly revealed fallback; Stop removes that frame. Availability and length are controlled by the provider; these previews do not create exact-clip records or unlock timed modes.

Spotify's current iframe loader requires dynamic JavaScript evaluation. On the web it runs in a dedicated local bridge document with a provider-specific CSP; the main app keeps its no-eval policy. Messages check the exact sending window and same origin. This is trusted provider code in a separate document, not a storage/security isolation boundary. An opaque sandbox was tested and rejected because it disables the nested Spotify player's required media capability.

Frames load only on request and are removed on card change, reveal, leaving the stage or opening the external song link. Native previews also unload when the app enters the background. Spotify loading and playback-start timeouts retain retry and QR/link fallbacks; actual playback progress, not a successful API request, drives the playing label. Timed Spotify control still needs Eratic's developer registration and provider permission. An existing native Spotify login is not an Eratic OAuth grant. Web MusicKit still needs a build-time developer token for authorized timed playback; the separate embedded preview does not. Live subscription/provider behavior and installed-app handoff need device verification.

Snippet Ladder and Original or Imposter still need exact clips; Lineup uses titles in manual playback. No game rules, storage keys or contract formats change.

Update (2026-10-11): every mode now shows each card's song backup (QR and hidden preview), so Snippet Ladder and Original or Imposter also start without exact clips. Snippet Ladder then plays each step as a snippet of the hidden preview that pauses itself after the step's length (timed from audible onset, step recorded at onset), reusing one loaded player per card with no app-side caching; without a preview the host marks steps by hand. Original or Imposter is played by hand from the backup. Game rules are unchanged: the engine already accepted `step` without a clip.

## Alternatives and revisit

HITSTER-style Spotify App Remote could reuse installed-app authorization on iOS, but would require a registered client, callback setup and an additional SDK and would not cover macOS/web. Revisit it when the application has provider registration and device acceptance coverage. Embeds deliberately remain separate from the game playback adapter. Apple provides no documented equivalent to Spotify's iframe control API, hence the separate preview file; do not depend on private shadow-DOM selectors, conceal provider upsells inside its page, or retry autoplay indefinitely. The static HITSTER comparison informed these boundaries, not a copied implementation.

Primary references: [Apple MusicKit](https://developer.apple.com/documentation/musickit), [Spotify iOS authorization and app lifecycle](https://developer.spotify.com/documentation/ios/concepts/application-lifecycle), [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk/howtos/web-app-player/).

Embed references: [Spotify iframe API](https://developer.spotify.com/documentation/embeds/references/iframe-api), [Apple embeddable player](https://artists.apple.com/support/1117-apple-music-marketing-tools), [iTunes Search/Lookup API](https://performance-partners.apple.com/search-api).
