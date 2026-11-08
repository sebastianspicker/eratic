import EraticCore
import Foundation

extension PlayableTrack {
    /// The card's first link for `provider`, reduced to a provider track ID by the shared `ScanRules.linkTrack`,
    /// like the web's `trackFor`. The manual player opens the first link of any provider.
    static func from(card: SongCard, provider: PlaybackProvider) -> PlayableTrack? {
        switch provider {
        case .spotify, .appleMusic:
            let kind: Provider = provider == .spotify ? .spotify : .appleMusic
            guard let link = card.links.first(where: { $0.provider == kind }),
                  let track = ScanRules.linkTrack(link) else { return nil }
            // A link with an explicit ID carries no storefront; keep the URL's when it has one.
            let storefront = track.storefront ?? ScanRules.providerTrack(link.url)?.storefront
            return PlayableTrack(provider: provider, id: track.id, storefront: storefront, url: URL(string: link.url))
        case .manual:
            guard let link = card.links.first, let url = URL(string: link.url) else { return nil }
            return PlayableTrack(provider: .manual, id: ScanRules.linkTrack(link)?.id ?? link.id ?? card.id, storefront: nil, url: url)
        }
    }
}
