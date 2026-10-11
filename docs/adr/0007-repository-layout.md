# ADR 0007 Repository layout follows ownership

Date: 2026-10-11. Status: accepted; historical research retention amended by [ADR 0012](0012-public-repository-and-private-archive.md).

## Context

The scaffold split its code and documentation in ways that hid ownership:

- **Swift core:** the Foundation-only core lived in `packages/SongQuizCore`, although its only consumer is the Apple app. `packages/` suggested shared libraries that do not exist.
- **Contract:** the interchange contract lived in a generically named `shared/`.
- **Web core:** its rules were mixed with fixtures and UI concerns in one module.
- **Tests:** each suite kept its own URL and QR-route vectors, and they had drifted apart.
- **Documentation:** the same status was repeated across `README.md`, `docs/STATUS.md`, `continuation.md`, `roadmap.md`, `verification.md`, both app READMEs and `CONTRIBUTING.md`. The previous agent guide had to require that three of them be kept aligned.
- **Research:** reports were split between `docs/` and `research/`.

## Decision

- **Contract:** `contract/` holds the canonical deck contract: the schema, the explicit rules, the sample deck and the executable cases (`cases/`). Both test suites run every case file.
- **Apple:** `apps/apple/` owns everything Apple: the SwiftUI sources, `project.yml`, and the core package at `apps/apple/SongQuizCore` (renamed `EraticCore` by [ADR 0009](0009-eratic-brand-and-eras.md)).
- **Web:** `apps/web/src/core/` mirrors the Swift core with the same concepts and names, and must not import UI or browser APIs (enforced by a test). UI lives in `src/ui/`; browser persistence and QR rendering are separate modules.
- **Swift core:** split into models with curation, the codec, and the card URL policy with QR routing. Display labels moved to the app.
- **Documentation:** project state, verification and next steps live only in `docs/STATUS.md`. `AGENTS.md` is the agent map, `CONTRIBUTING.md` the human setup guide, and `README.md` the entry point. Research reports originally lived in `research/`; ADR 0012 moves them to the ignored local private archive. The `docs/architecture.md` pointer, `docs/README.md` index, `continuation.md`, `roadmap.md` and `verification.md` were merged and removed.

## Consequences

- Each concept has one home, and each rule has one set of shared cases.
- Paths cited in earlier notes changed. No external consumer referenced them: there is no remote, nothing has been published, and deck files cannot embed a schema path.
- The Makefile targets and CI jobs are unchanged.

## Alternatives and revisit condition

- **Keep `packages/`:** only worth it once a second consumer exists, such as a command-line tool.
- **A JavaScript workspace or a shared code generator for both cores:** more tooling than one npm package and two small cores justify.

Revisit when a second app or library needs the Swift core, or when the cores grow enough that generating one from a shared description beats parity testing.
