# ADR 0002 Versioned portable deck contract

Date: 2026-10-11. Status: implemented. Amended by [ADR 0007](0007-repository-layout.md) (contract location) and [ADR 0008](0008-explicit-text-and-url-rules.md) (text and URL rules).

## Context

Native and browser editors must exchange cards without losing identity, provider metadata, or deliberate corrections. Research showed why a provider's album release date can be unsuitable as the game's answer year.

## Decision

Define version-one JSON Schema in `shared/schema`. Cards have stable IDs, title/artist, source-backed curated year, optional recording identity, provider links, and an optional supplied official mapping. Unknown fields and unsupported versions are rejected. Both implementations run common contract cases plus semantic URL and duplicate-ID checks.

Limit import/export to 8 MiB of UTF-8 data, with readable output when it fits and compact output otherwise. Field length limits count Unicode code points. Keep provider dates separate from `gameYear`; retain optional metadata through curation and export.

## Consequences

Files can move between Apple and web without a service. Strict rejection prevents silent loss of future fields, but schema evolution requires migration rather than permissive partial imports. The shared package's tests depend on the repository's canonical fixtures. IDs do not change when a link or answer is corrected.

## Alternatives and revisit condition

A shared remote database would require hosting and identity before basic editing works. Provider-shaped records would couple the deck to one service. Revisit the format through a new version when a concrete feature cannot be represented safely; do not silently add unsupported fields.

References: [contract](../../contract/README.md), [schema](../../contract/deck-v1.schema.json), [attribution](../ATTRIBUTION.md).

