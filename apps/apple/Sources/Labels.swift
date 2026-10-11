import EraticCore

extension Provider {
    var label: String {
        switch self {
        case .spotify: return "Spotify"
        case .appleMusic: return "Apple Music"
        case .youtube: return "YouTube"
        case .other: return "Other"
        }
    }
}

extension QRMode {
    var label: String {
        switch self {
        case .official: return "Official card"
        case .directLink: return "Direct link"
        case .eraticCard: return "Eratic card"
        }
    }
}
