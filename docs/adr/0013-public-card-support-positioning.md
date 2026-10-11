# ADR 0013 Public positioning for card support

Date: 2026-10-11. Status: accepted by the user; documentation updated. Amends the public positioning of [ADR 0003](0003-explicit-qr-routes.md).

## Context

Eratic scans cards represented in a loaded deck. Original HITSTER cards require additional mappings that Eratic neither bundles nor retrieves automatically. Private catalogue imports require setup, and provider-derived years do not establish the answers printed on physical cards. Existing URL fields and private experiments do not establish an out-of-the-box feature.

## Decision

Do not advertise original HITSTER-card support or official-app compatibility in public product copy or roadmaps. Describe Eratic through user-curated decks, linked QR codes and its own game modes. The user explicitly chose this positioning after reviewing the catalogue dependency and setup requirements.

## Consequences

Remove the old official-app product requirement and catalogue-import roadmap promise from current public-facing documentation. Preserve accurate technical descriptions, attribution and historical rationale. Existing supplied-URL fields, scan rules and deck compatibility are unchanged. Private catalogue material remains outside public source and app bundles under [ADR 0012](0012-public-repository-and-private-archive.md).

## Alternatives considered

Advertising manual catalogue import would imply a supported onboarding path that is not implemented. Promising automatic manufacturer-catalogue retrieval would add an unresolved external dependency. Neither is a public feature commitment.

## Revisit

Revisit only with an explicit product decision backed by a reliable mapping source suitable for distribution and a verified end-to-end experience using physical cards.
