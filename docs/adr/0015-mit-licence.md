# ADR 0015 MIT licence for the project's own code

Date: 2026-10-11. Status: accepted by the user; licence added.

## Context

The repository is public with a public web demo, but no distribution licence had been chosen, so nobody else had permission to reuse the code. The code is written for this repository and copies no upstream code ([ATTRIBUTION.md](../ATTRIBUTION.md)); upstream projects informed ideas only. Production web dependencies are MIT, ISC, BSD-3-Clause and Apache-2.0 (jsQR); the bundled typeface is under the SIL Open Font License 1.1. The native app uses only Apple frameworks. None of these imposes copyleft terms on Eratic's own code.

## Decision

License the project's own code under the [MIT License](../../LICENSE), copyright Sebastian Spicker. Declare it in `apps/web/package.json`.

## Consequences

Anyone may use, modify and redistribute the code, including commercially, if they keep the copyright and licence notice. Dependencies and the bundled font keep their own licences and notices. The licence grants no rights to song recordings, metadata, artwork or third-party trademarks, and none to the private archive, which stays outside the repository under [ADR 0012](0012-public-repository-and-private-archive.md). Contributions are accepted under the same licence. Copying external code still requires recording its source, revision, licence and notices first.

## Alternatives considered

Apache-2.0 adds an explicit patent grant at the cost of NOTICE handling; not needed for this project. GPL-3.0 or AGPL-3.0 would keep derivatives open but restrict reuse in closed or commercial products, which the user did not want to prevent.

## Revisit

If code under an incompatible licence is ever adopted, if the "Eratic" name or logo needs protection beyond what MIT already withholds (it grants no trademark rights), or if the project accepts contributions needing a contributor agreement.
