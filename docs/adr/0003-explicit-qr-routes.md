# ADR 0003 Explicit QR routes and unverified official mappings

Date: 2026-10-11. Status: implemented.

## Context

The original requirement is arbitrary custom-song playback in the official Hitster app. The reviewed repositories provide generators or their own scanners; the bounded Android review found catalogue-backed normal resolution and no intended custom-song import route. Formatting a QR like an official card does not establish a catalogue entry or a matching song.

## Decision

Default to a user-supplied official-card URL with a conservative recognized-input check. Preserve its exact payload and label the mapping unverified. With no mapping, show an unavailable preview. Direct provider-link preview is a separate explicit choice. Never manufacture official identifiers, substitute a direct link silently, or infer playback compatibility from URL syntax.

## Consequences

Fictional demo cards have no official QR. Users can inspect a supplied mapping without the application certifying its recording association. The original arbitrary-song requirement remains open. A later independent scanner is a different feature with its own product decision.

## Alternatives and revisit condition

Automatically using a provider link would obscure whether the original requirement was met. Generating official-looking URLs would create unsupported identifiers. Revisit this decision when a documented supported extension/partner route or ordinary input test provides concrete new evidence. Do not base the change on a catalogue scrape or cosmetic QR similarity.

References: [attribution](../ATTRIBUTION.md), [QR route](../../apps/apple/EraticCore/Sources/EraticCore/CardURLs.swift). Historical research is retained locally under the publication policy in [ADR 0012](0012-public-repository-and-private-archive.md).

