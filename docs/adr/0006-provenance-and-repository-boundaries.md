# ADR 0006 Preserve provenance and keep local artifacts separate

Date: 2026-10-11. Status: implemented; research retention and publication amended by [ADR 0012](0012-public-repository-and-private-archive.md).

## Context

The workspace contains original scaffold code, third-party research reports, a downloaded APK, decompiled sources, and an encrypted catalogue asset. Those materials have different origins and purposes. The user also requested explicit references wherever other projects informed an adaptation or improvement.

## Decision

Track original application source, shared fictional fixtures, reproducible project specifications, dependency lockfiles, curated research notes, and an attribution map. Ignore downloaded/decompiled binaries, catalogue payloads, logs, generated projects, dependencies, build/QA output, credentials, private decks, and local collaboration notes.

Distinguish conceptual inspiration from copied code and runtime dependencies. Any future source reuse requires exact provenance and applicable license notices. Do not select a distribution license on the owner's behalf or infer one from an upstream project. The user retains responsibility for commits and publication.

## Consequences

Fresh checkouts build from the scaffold without local research artifacts. Historical research links to ignored files may not resolve on another machine; curated conclusions and provenance remain available. The original project code's license and production release identity are open decisions. This record describes the initial local-only setup; current publication boundaries are in ADR 0012.

## Alternatives and revisit condition

Committing the entire research directory would blur runtime dependencies and include unnecessary third-party artifacts. Omitting provenance would make later reuse and review harder. Revisit artifact retention only for a concrete reproducibility need, with appropriate ownership and distribution decisions.

References: [ignore rules](../../.gitignore), [attribution](../ATTRIBUTION.md), [contributing](../../CONTRIBUTING.md).

