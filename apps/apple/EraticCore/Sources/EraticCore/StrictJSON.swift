import Foundation

/// Enforces the contract's JSON text rules before Foundation parses anything.
/// `JSONSerialization` accepts trailing commas and UTF-16/32 input, and it
/// disagrees with `JSONDecoder` about which duplicate member wins.
public enum StrictJSON {
    static let maximumDepth = 512

    /// Returns `data` without a leading UTF-8 BOM, or throws if it is not
    /// RFC 8259 JSON text in UTF-8 with unique member names.
    public static func validate(_ data: Data) throws -> Data {
        var bytes = [UInt8](data)
        if bytes.starts(with: [0xEF, 0xBB, 0xBF]) { bytes.removeFirst(3) }
        guard isValidUTF8(bytes) else { throw DeckError("Deck file must be UTF-8 encoded JSON.") }
        var parser = Parser(bytes)
        try parser.parseDocument()
        return Data(bytes)
    }

    /// The members of a parsed JSON object with their names exactly as written, or `nil` when
    /// `raw` is not an object. Read through `NSDictionary`, never `[String: Any]`: Swift `String`
    /// keys compare under canonical equivalence, so `titleOK` spelled with U+212A KELVIN SIGN
    /// would look up as `titleOK` (game-rules.md section 1.1).
    static func members(_ raw: Any) -> [(name: String, value: Any)]? {
        guard let dictionary = raw as? NSDictionary else { return nil }
        var result = [(name: String, value: Any)]()
        for (key, value) in dictionary {
            guard let name = key as? String else { return nil }
            result.append((name, value))
        }
        return result
    }

    /// The name in `names` spelled exactly like `name`, code point by code point.
    static func exactName<Names: Sequence>(_ name: String, in names: Names) -> String? where Names.Element == String {
        names.first { $0.utf8.elementsEqual(name.utf8) }
    }

    private static func isValidUTF8(_ bytes: [UInt8]) -> Bool {
        var iterator = bytes.makeIterator()
        var decoder = UTF8()
        while true {
            switch decoder.decode(&iterator) {
            case .scalarValue: continue
            case .emptyInput: return true
            case .error: return false
            }
        }
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0

        init(_ bytes: [UInt8]) { self.bytes = bytes }

        private func fail(_ reason: String) -> DeckError {
            DeckError("Invalid JSON at byte \(index): \(reason).")
        }

        private var current: UInt8? { index < bytes.count ? bytes[index] : nil }

        private mutating func skipWhitespace() {
            while let byte = current, byte == 0x20 || byte == 0x09 || byte == 0x0A || byte == 0x0D { index += 1 }
        }

        mutating func parseDocument() throws {
            skipWhitespace()
            try parseValue(depth: 1)
            skipWhitespace()
            guard index == bytes.count else { throw fail("unexpected data after the top-level value") }
        }

        private mutating func parseValue(depth: Int) throws {
            guard depth <= StrictJSON.maximumDepth else { throw fail("nesting deeper than \(StrictJSON.maximumDepth)") }
            switch current ?? 0 {
            case UInt8(ascii: "{"): try parseObject(depth: depth)
            case UInt8(ascii: "["): try parseArray(depth: depth)
            case UInt8(ascii: "\""): _ = try parseString()
            case UInt8(ascii: "t"): try parseLiteral("true")
            case UInt8(ascii: "f"): try parseLiteral("false")
            case UInt8(ascii: "n"): try parseLiteral("null")
            case UInt8(ascii: "-"), UInt8(ascii: "0")...UInt8(ascii: "9"): try parseNumber()
            default: throw fail("expected a value")
            }
        }

        private mutating func parseLiteral(_ word: String) throws {
            let expected = Array(word.utf8)
            guard index + expected.count <= bytes.count, bytes[index..<(index + expected.count)].elementsEqual(expected) else {
                throw fail("invalid literal")
            }
            index += expected.count
        }

        private mutating func parseObject(depth: Int) throws {
            index += 1
            var names = Set<[UInt8]>()
            skipWhitespace()
            if current == UInt8(ascii: "}") { index += 1; return }
            while true {
                skipWhitespace()
                guard current == UInt8(ascii: "\"") else { throw fail("expected a member name") }
                let name = try parseString()
                // Names compare as unescaped scalars, never by Unicode equivalence.
                guard names.insert(name).inserted else { throw DeckError("Duplicate member name: \(String(decoding: name, as: UTF8.self)).") }
                skipWhitespace()
                guard current == UInt8(ascii: ":") else { throw fail("expected ':'") }
                index += 1
                skipWhitespace()
                try parseValue(depth: depth + 1)
                skipWhitespace()
                switch current {
                case UInt8(ascii: ","): index += 1
                case UInt8(ascii: "}"): index += 1; return
                default: throw fail("expected ',' or '}'")
                }
            }
        }

        private mutating func parseArray(depth: Int) throws {
            index += 1
            skipWhitespace()
            if current == UInt8(ascii: "]") { index += 1; return }
            while true {
                skipWhitespace()
                try parseValue(depth: depth + 1)
                skipWhitespace()
                switch current {
                case UInt8(ascii: ","): index += 1
                case UInt8(ascii: "]"): index += 1; return
                default: throw fail("expected ',' or ']'")
                }
            }
        }

        /// Returns the unescaped UTF-8 bytes of the string.
        private mutating func parseString() throws -> [UInt8] {
            index += 1
            var out = [UInt8]()
            while true {
                guard let byte = current else { throw fail("unterminated string") }
                index += 1
                switch byte {
                case UInt8(ascii: "\""): return out
                case 0..<0x20: index -= 1; throw fail("unescaped control character in string")
                case UInt8(ascii: "\\"):
                    guard let escape = current else { throw fail("unterminated string") }
                    index += 1
                    switch escape {
                    case UInt8(ascii: "\""), UInt8(ascii: "\\"), UInt8(ascii: "/"): out.append(escape)
                    case UInt8(ascii: "b"): out.append(0x08)
                    case UInt8(ascii: "f"): out.append(0x0C)
                    case UInt8(ascii: "n"): out.append(0x0A)
                    case UInt8(ascii: "r"): out.append(0x0D)
                    case UInt8(ascii: "t"): out.append(0x09)
                    case UInt8(ascii: "u"): out.append(contentsOf: try parseUnicodeEscape())
                    default: index -= 1; throw fail("invalid escape")
                    }
                default: out.append(byte)
                }
            }
        }

        /// Called after `\u`; combines surrogate pairs and rejects unpaired surrogates.
        private mutating func parseUnicodeEscape() throws -> [UInt8] {
            let first = try parseHex4()
            var value = first
            if (0xD800...0xDBFF).contains(first) {
                guard current == UInt8(ascii: "\\"), index + 1 < bytes.count, bytes[index + 1] == UInt8(ascii: "u") else {
                    throw fail("unpaired surrogate escape")
                }
                index += 2
                let second = try parseHex4()
                guard (0xDC00...0xDFFF).contains(second) else { throw fail("unpaired surrogate escape") }
                value = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00)
            } else if (0xDC00...0xDFFF).contains(first) {
                throw fail("unpaired surrogate escape")
            }
            guard let scalar = Unicode.Scalar(value) else { throw fail("invalid code point") }
            return Array(String(Character(scalar)).utf8)
        }

        private mutating func parseHex4() throws -> UInt32 {
            var value: UInt32 = 0
            for _ in 0..<4 {
                guard let byte = current else { throw fail("truncated \\u escape") }
                let digit: UInt32
                switch byte {
                case UInt8(ascii: "0")...UInt8(ascii: "9"): digit = UInt32(byte - UInt8(ascii: "0"))
                case UInt8(ascii: "a")...UInt8(ascii: "f"): digit = UInt32(byte - UInt8(ascii: "a")) + 10
                case UInt8(ascii: "A")...UInt8(ascii: "F"): digit = UInt32(byte - UInt8(ascii: "A")) + 10
                default: throw fail("invalid \\u escape")
                }
                value = value << 4 | digit
                index += 1
            }
            return value
        }

        /// `-? (0 | [1-9][0-9]*) (\.[0-9]+)? ([eE][+-]?[0-9]+)?`
        private mutating func parseNumber() throws {
            if current == UInt8(ascii: "-") { index += 1 }
            switch current ?? 0 {
            case UInt8(ascii: "0"): index += 1
            case UInt8(ascii: "1")...UInt8(ascii: "9"): skipDigits()
            default: throw fail("invalid number")
            }
            if current == UInt8(ascii: ".") {
                index += 1
                guard skipDigits() else { throw fail("invalid number fraction") }
            }
            if current == UInt8(ascii: "e") || current == UInt8(ascii: "E") {
                index += 1
                if current == UInt8(ascii: "+") || current == UInt8(ascii: "-") { index += 1 }
                guard skipDigits() else { throw fail("invalid number exponent") }
            }
        }

        @discardableResult
        private mutating func skipDigits() -> Bool {
            let start = index
            while let byte = current, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(byte) { index += 1 }
            return index > start
        }
    }
}
