# ADR 0009 Product name Eratic and the era design system

Date: 2026-10-11. Status: accepted by the user (name and design concept); implemented.

## Context

"QR Song Quiz" described the mechanism rather than the experience. The user rejected two rounds of candidates: the first as too ordinary, the second as too snobbish. They chose the concept that every era gets its own style card. The first name for it, *Decadance*, is already used by club nights, an iOS radio app ("Decadance UK"), a eurodance act and the "Deckadance" DJ app. Web searches for *Eratic* found no brand, company, app or game; registry checks have not yet been done.

## Decision

- **Name:** Eratic. The tagline is "Spelled wrong. Dated right." and the secondary line "Every era has a move." The wordmark sets "era" bold, in the current era's style, and "tic" light; the dot of the i is a QR finder square.
- **Era design system:**
  - Nine eras: before 1950, then each decade from the 1950s to the 2020s and later.
  - Each era has a ground, ink, accent, text-on-accent colour, a glow for the dark stage, a type move and a pattern.
  - The tokens live once in `design/eras.json`. The web reads them directly (`src/ui/eras.ts`). The Apple app bundles the file, and `EraticCore` decodes and validates it (`EraTokens.swift`, tested against the real file); the app maps the tokens to SwiftUI colours and fonts (`Sources/Era.swift`).
  - Era styling follows a card's curated year and is presentation only.
  - The app chrome is a neutral stage, and QR codes are never styled.
- **Type:**
  - Web: Bricolage Grotesque (OFL-1.1), bundled through `@fontsource-variable/bricolage-grotesque`, so no font request leaves the app ([ADR 0005](0005-local-first-storage.md) stays intact).
  - Apple: the system font, with matching width and weight.
- **Renamed:** user-facing names, the web page title and favicon, the npm package (`@eratic/web`), the Swift package and module (`EraticCore`), the Xcode project, targets and schemes (`Eratic`, `Eratic-macOS`, `Eratic-iOS`), the product and display name, the placeholder bundle IDs (`com.example.eratic.macos`/`.ios`), and the web's download name for unreadable saved data.
- **Kept on purpose:**
  - The browser storage keys `qr-song-quiz.deck.v1` and `….unreadable`. They hold users' decks, and renaming them would need a migration for no user benefit.
  - The deck schema's `$id` and `title`, which keep the interchange contract byte-identical. Deck files cannot reference them.
  - The repository directory name, which the user owns.

## Consequences

- **Contrast:** the era tests enforce it, so a token change that would make text unreadable fails `make web-check`.
- **One token file:** both apps read the same file, so adding or changing an era is one edit plus a visual check on each platform.
- **Patterns:** the web draws all nine, as CSS kept in step with the token colours by hand. Apple currently shows each era's colours and type move but not its pattern.
- **Apple build unverified:** the renamed Xcode project, targets and resource bundling have only been type-checked, and the user still needs to run `make apple-build`.
- **Unverified clearance:** trademark (EUIPO/DPMA), App Store title and domain availability are not yet checked, and must be before any public release.

## Alternatives and revisit condition

Decadance had the same concept but was already in use. Throwdeck and Retrospin were clean nine-letter alternatives. Yesterbeat and Eraoke were also clean but fitted less well. A single fixed wordmark style was rejected because the moving "era" is the brand's idea.

Revisit if registry checks find a conflict, or if the user wants genre-specific styles: those would need a genre field in the deck format, which is a contract change.
