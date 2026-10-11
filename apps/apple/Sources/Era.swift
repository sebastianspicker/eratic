import SwiftUI
import EraticCore

/// The bundled `design/eras.json`, decoded and validated by `EraticCore`.
enum Eras {
    static let all: [Era] = {
        do {
            guard let url = Bundle.main.url(forResource: "eras", withExtension: "json") else {
                throw EraTokenError("eras.json is missing from the app bundle.")
            }
            return try Era.decodeAll(from: Data(contentsOf: url))
        } catch {
            // Views fall back to system styling, but a broken token file must not go unnoticed.
            assertionFailure("Era tokens unavailable: \(error.localizedDescription)")
            return []
        }
    }()

    static func `for`(_ year: Int) -> Era? { Era.era(for: year, in: all) }
}

extension Era {
    var groundColor: Color { Color(hex: ground) }
    var inkColor: Color { Color(hex: ink) }
    var accentColor: Color { Color(hex: accent) }
    var onAccentColor: Color { Color(hex: onAccent) }
    var glowColor: Color { Color(hex: glow) }

    /// The era's type move on the system font: width and weight match the web's variable axes.
    func font(size: CGFloat) -> Font {
        let width: Font.Width = type.width <= 80 ? .compressed : type.width < 100 ? .condensed : .standard
        let weight: Font.Weight = switch type.weight {
        case ..<350: .light
        case ..<550: .medium
        case ..<650: .semibold
        case ..<750: .bold
        default: .heavy
        }
        return .system(size: size, weight: weight).width(width)
    }

    var textCase: Text.Case? {
        switch type.case {
        case "upper": .uppercase
        case "lower": .lowercase
        default: nil
        }
    }
}

/// Stage colours shared by both apps (DESIGN.md).
enum Stage {
    static let ink = Color(hex: "#17131C")
    static let paper = Color(hex: "#F7F2E8")
}

extension Color {
    /// `#RRGGBB` only (the token format `EraticCore` validates); anything else renders as clear.
    init(hex: String) {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else {
            self = .clear
            return
        }
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
