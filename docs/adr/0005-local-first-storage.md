# ADR 0005 Local operation and file interchange

Date: 2026-10-11. Status: implemented. Amended by [ADR 0008](0008-explicit-text-and-url-rules.md): a saved web deck that no longer validates is quarantined and offered for download, never overwritten.

## Context

Both applications should be usable before provider accounts or a shared service exist. A small scaffold needs explicit persistence behavior so an edited deck is not mistaken for a synchronized or remotely backed-up collection.

## Decision

Use user-selected JSON import/export as the cross-platform exchange path. Apple edits stay in memory until exported. Web imports and explicit saves attempt browser local storage; failures retain the in-memory deck and direct the user to export. The initial fictional sample is not labeled stored until a save/import succeeds.

Add no account system, cloud database, telemetry, provider calls, or synchronization service. Export remains available independently of browser storage. Export falls back to compact JSON near the byte limit so indentation alone does not prevent saving.

## Consequences

There is no hosting dependency for curation. Browser storage is device/origin-specific and not a backup; Apple users must export before closing to retain edits. The two platforms' persistence differs and is documented. Native document-based autosave and conflict-aware synchronization remain separate design decisions.

## Alternatives and revisit condition

Cloud-first storage would expand the scaffold into authentication, hosting, privacy, and conflict management. Immediate native autosave would need document ownership and lifecycle decisions. Revisit persistence once multi-deck document management or reliable cross-device continuity becomes the next agreed feature.

References: [web storage](../../apps/web/src/storage.ts), [Apple workspace](../../apps/apple/Sources/DeckWorkspace.swift), [design](../../DESIGN.md).

