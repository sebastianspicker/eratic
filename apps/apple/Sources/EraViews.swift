import SwiftUI
import EraticCore

/// "era" takes the current card's era style; "tic" keeps time. Read as one word by VoiceOver.
struct Wordmark: View {
    let era: Era?
    @ScaledMetric(relativeTo: .title) private var size: CGFloat = 28

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text("era")
                .font(era?.font(size: size) ?? .system(size: size, weight: .heavy))
                .textCase(era?.textCase)
                .foregroundStyle(era?.glowColor ?? Stage.paper)
                .rotationEffect(.degrees(era?.type.tilt ?? 0))
            Text("tic")
                .font(.system(size: size, weight: .light))
                .foregroundStyle(Stage.paper)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Eratic")
    }
}

/// The curated year in its era's type move. It drops in when it appears; give it `.id(year)`
/// so a changed year appears again.
struct EraYear: View {
    let year: Int
    let era: Era?
    @ScaledMetric(relativeTo: .largeTitle) private var size: CGFloat = 72
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var landed = false

    var body: some View {
        Text(String(year))
            .font(era?.font(size: size) ?? .system(size: size, weight: .semibold, design: .rounded))
            .tracking((era?.type.tracking ?? 0) * size)
            .monospacedDigit()
            .foregroundStyle(era?.accentColor ?? .accentColor)
            .shadow(color: era?.type.glow == true ? (era?.glowColor ?? .clear).opacity(0.6) : .clear, radius: 9)
            .rotationEffect(.degrees(era?.type.tilt ?? 0), anchor: .leading)
            .offset(y: landed || reduceMotion ? 0 : -18)
            .opacity(landed || reduceMotion ? 1 : 0)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.spring(response: 0.45, dampingFraction: 0.55)) { landed = true }
            }
    }
}

/// A year as a pill in its era's accent, for lists.
struct YearChip: View {
    let year: Int

    var body: some View {
        let era = Eras.for(year)
        Text(String(year))
            .font(.system(.subheadline, design: .rounded).weight(.heavy))
            .monospacedDigit()
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .foregroundStyle(era?.onAccentColor ?? .primary)
            .background(Capsule().fill(era?.accentColor ?? Color.secondary.opacity(0.2)))
            .accessibilityLabel(era.map { "\(year), \($0.label) \($0.name)" } ?? String(year))
    }
}

/// The card's era takes the spotlight: ground, label, the dropping year, then the song.
struct EraHero: View {
    let card: SongCard
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let era = Eras.for(card.gameYear.value)
        VStack(alignment: .leading, spacing: 8) {
            if let era {
                Text("\(era.label) · \(era.name)")
                    .font(.footnote.weight(.semibold))
                    .textCase(.uppercase)
                    .tracking(1.6)
            }
            EraYear(year: card.gameYear.value, era: era)
                .id(card.gameYear.value)
            Text(card.title).font(.largeTitle.bold())
            Text(card.artist).font(.title3)
            if let version = card.recordingVersion { Text(version).font(.subheadline) }
        }
        .foregroundStyle(era?.inkColor ?? .primary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(24)
        .background(era?.groundColor ?? Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 16))
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.45), value: era?.id)
    }
}
