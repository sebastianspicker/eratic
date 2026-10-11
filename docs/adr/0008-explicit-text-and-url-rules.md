# ADR 0008 Explicit text and URL acceptance rules in the contract

Date: 2026-10-11. Status: accepted; amends the validation part of [ADR 0002](0002-versioned-deck-contract.md).

## Context

ADR 0002 promised that a deck accepted by one application is accepted by the other. Probes against the scaffold showed it was not:

- A title consisting only of U+FEFF was rejected on the web but accepted by Swift.
- Titles consisting only of U+0085 or U+200B were accepted on the web but rejected by Swift.
- URLs containing U+0080, U+0085 or U+200B were accepted on the web but rejected by Swift.
- A title containing an unpaired surrogate (`"\ud800"`) passed web validation and was exported, but Swift cannot decode it.

The independent final review of the reconstruction found more of the same at the JSON-text level:

- Swift took the first of two duplicate member names, the web the last, so each app read a different deck from one file.
- Swift accepted trailing commas and UTF-16/UTF-32 files that the web rejects.
- On the web, browser decoding replaced invalid UTF-8 with U+FFFD, where Swift rejected it.

The cause was that each side delegated part of the rule to its platform. Text used Foundation's `whitespacesAndNewlines`, which differs from ECMAScript `\s`. URLs went through WHATWG `URL` or Foundation `URLComponents`, two parsers that disagree, and Foundation's leniency changes between OS releases, while the Apple app supports macOS 14 and iOS 17. The shared cases did not exercise any of this, and each test suite kept its own URL vectors.

## Decision

The [contract README](../../contract/README.md) states the text and URL rules directly, and both implementations encode them without a platform URL parser:

- **Visible text** means the schema's ECMAScript `\S`. Swift hard-codes the 25 ECMAScript whitespace code points.
- **URLs** reject Cc, Cf, Zs, Zl and Zp code points and backslashes. The authority is checked with an explicit host/port grammar.
- **Strings** must be well-formed Unicode.
- **Files** are strict RFC 8259 JSON in UTF-8 (a leading BOM is ignored) with no duplicate member names. Each core checks this itself before handing the text to its platform parser.

URL vectors and QR-route expectations moved into `contract/cases/`, which both test suites run.

Inputs that both applications previously accepted keep being accepted: non-ASCII paths and hosts, `|`, malformed percent escapes in paths, an empty port and `:0443`. The intentional changes are listed below.

| Input | Web before | Swift before | Both after | Reason |
| --- | --- | --- | --- | --- |
| URL containing C1 controls, Cf or Zl/Zp/Zs code points | Some accepted | Rejected | Rejected | Invisible characters change what a printed QR opens without being visible; the contract already promised that control characters are rejected |
| Percent-encoded host (`https://exa%41mple.com`) | Accepted | Accepted | Rejected | The host shown to the user differs from the host opened |
| Title containing only U+0085 or U+200B | Accepted | Rejected | Accepted | The schema is canonical |
| Title containing only U+FEFF | Rejected | Accepted | Rejected | The schema is canonical |
| Unpaired surrogate in any string | Accepted | Rejected | Rejected | The deck cannot be exported in a form the other application can read |
| Duplicate member names | Last wins | First wins | Rejected | The two apps read different decks from the same file |
| Trailing commas, UTF-16/UTF-32 files | Rejected | Accepted | Rejected | RFC 8259 and UTF-8 are what both platforms read identically |
| Invalid UTF-8 bytes | Replaced with U+FFFD | Rejected | Rejected | Silent replacement corrupts text and is then exported |
| Bracketed IP-literal host (`https://[::1]/`) | Accepted if valid | Accepted, even `[:]` | Rejected | No provider uses them; validating IPv6 syntax is not worth two implementations |
| Malformed numeric host (`https://256.1.1.1/`) | Rejected | Accepted | Accepted | Host names are not resolved or validated beyond the grammar; such a link simply fails to open. Documented loosening on the web |

## Consequences

Parity is now defined by data rather than by two parsers. A web-saved deck that used one of the newly rejected inputs no longer loads. The web app therefore keeps an unreadable saved value under a separate storage key and offers it for download instead of overwriting it. Hosts are not converted between IDNA forms and Unicode, and rendering a non-ASCII URL in a QR remains each scanner's concern.

## Alternatives and revisit condition

- **Make Swift use `URLComponents(string:encodingInvalidCharacters:)`.** It would still define the rule by two platform parsers.
- **Accept only printable ASCII in URLs.** It is cleaner, but it would reject inputs that both applications accept today, and nothing showed those inputs to be harmful.

Revisit when a provider URL that users need is rejected, or when the format moves to a new schema version.
