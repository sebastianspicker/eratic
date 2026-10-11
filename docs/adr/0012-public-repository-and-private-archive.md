# ADR 0012 Public source and demo, local private archive

Date: 2026-10-11. Status: accepted by the user; public repository and GitHub Pages demo requested. Amends [ADR 0006](0006-provenance-and-repository-boundaries.md) and [ADR 0007](0007-repository-layout.md).

## Decision

Publish the maintained application source, fictional contract fixtures, current product documentation and attribution. Deploy only `apps/web/dist` to GitHub Pages, built and tested by GitHub Actions without provider credentials.

Keep historical research (including downloaded/decompiled material and provenance), the superseded game implementation ledger, old verification logs and unrelated private task notes in ignored `private/`. A local archive manifest records file sizes and SHA-256 hashes. Keep current game explanations in `docs/game-modes.md`, exact rules in `contract/game-rules.md`, interactions in `DESIGN.md`, and outstanding decisions in `docs/STATUS.md`.

Start the public repository from a clean source snapshot so archived material is absent from public Git history as well as the current tree. Preserve the earlier local history in a private Git bundle and local archive branch. Push only the public `main` branch; do not mirror or push all local refs. Commits contain no co-author trailers.

## Consequences

The private archive is not a runtime or build dependency and is not uploaded to GitHub or Pages. Existing deck/session formats, storage keys and scoring rules are unchanged. Public source does not include a distribution licence unless the owner separately selects one; publication does not grant rights to music or metadata.

A Pages deployment hosts the standalone web app only. It does not enable streaming accounts, establish official-app compatibility, serve a song catalogue or select the future Eratic card QR domain.

## Revisit

Revisit provider configuration only after live-account and intended-use checks. Revisit archive publication only with an explicit owner decision about the specific material and its history.
