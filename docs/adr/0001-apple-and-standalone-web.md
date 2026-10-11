# ADR 0001 Native Apple app and standalone web companion

Date: 2026-10-11. Status: platform requirement chosen by user; implemented.

## Context

The user selected a universal app with a standalone web companion and clarified that universal means Mac, iPad, and iPhone. This replaced the initially proposed CLI-first approach. The browser application must be useful without the Apple app running.

## Decision

Use one SwiftUI source tree targeting macOS 14 and iOS/iPadOS 17. Put portable value types and validation in a Foundation-only Swift package. Generate Mac and iOS Xcode targets from an XcodeGen specification. Use React, TypeScript, and Vite for an independently hosted static companion. Share the data contract and fixtures across implementations.

## Consequences

Apple gets platform-native navigation and file dialogs; browsers get independent deployment. UI code and validators exist in two languages, requiring shared contract tests. Minimum OS versions allow modern SwiftUI without broad compatibility shims. Device signing and distribution are separate from the scaffold's unsigned build checks.

## Alternatives and revisit condition

A Python CLI would simplify print tooling but does not meet the selected interface/platform requirement. A web-only wrapper would share more code but would change the native-app choice. Revisit the split only if the user changes the product platforms or maintenance costs justify an explicit architecture change.

References: [architecture](../../ARCHITECTURE.md), [Apple project specification](../../apps/apple/project.yml), [web manifest](../../apps/web/package.json).

