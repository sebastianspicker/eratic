import Foundation
import OSLog
#if os(iOS)
import UIKit
#endif

/// What a tester attaches to a bug report: the build and the latest problems the app showed.
/// Kept in memory and in the system log on this device; nothing is sent anywhere (ADR 0005),
/// and the text leaves only when the user copies it.
@MainActor
enum Diagnostics {
    static let build: String = {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "unknown"
        let number = info?["CFBundleVersion"] as? String ?? "unknown"
        return "\(version) (\(number))"
    }()
    private static let limit = 50
    private static let log = Logger(subsystem: Bundle.main.bundleIdentifier ?? "Eratic", category: "problems")
    private static var entries: [String] = []

    static func record(_ area: String, _ message: String) {
        log.error("[\(area, privacy: .public)] \(message, privacy: .public)")
        entries.append("\(Date().ISO8601Format()) [\(area)] \(message)")
        if entries.count > limit { entries.removeFirst(entries.count - limit) }
    }

    static func text() -> String {
        #if os(iOS)
        let system = "\(UIDevice.current.model) \(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
        #else
        let system = "macOS \(ProcessInfo.processInfo.operatingSystemVersionString)"
        #endif
        return ([
            "Eratic \(build)",
            "Copied \(Date().ISO8601Format())",
            "System \(system)",
            "",
        ] + (entries.isEmpty ? ["No problems recorded since the app opened."] : entries)).joined(separator: "\n")
    }
}
