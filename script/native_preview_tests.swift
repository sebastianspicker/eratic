import AVFoundation
import Foundation

// Compile alongside the actual ApplePreviewPlayer.swift. Real AVFoundation classes
// deliver KVO; only network results, transport commands and deadlines are controlled.
private final class PreviewItem: AVPlayerItem {
    private var testStatus: AVPlayerItem.Status = .unknown
    override var status: AVPlayerItem.Status { testStatus }
    init() { super.init(asset: AVMutableComposition(), automaticallyLoadedAssetKeys: [] as [String]) }
    func report(_ status: AVPlayerItem.Status) {
        willChangeValue(forKey: "status")
        testStatus = status
        didChangeValue(forKey: "status")
    }
}

private final class PreviewPlayer: AVPlayer {
    let item = PreviewItem()
    private var control: AVPlayer.TimeControlStatus = .paused
    var playCalls = 0
    var pauseCalls = 0
    var seeks: [(Bool) -> Void] = []
    override var timeControlStatus: AVPlayer.TimeControlStatus { control }
    override init() { super.init(); replaceCurrentItem(with: item) }
    override func play() { playCalls += 1 }
    override func pause() { pauseCalls += 1 }
    override func seek(to time: CMTime, toleranceBefore: CMTime, toleranceAfter: CMTime,
                       completionHandler: @escaping (Bool) -> Void) { seeks.append(completionHandler) }
    func report(_ control: AVPlayer.TimeControlStatus) {
        willChangeValue(forKey: "timeControlStatus")
        self.control = control
        didChangeValue(forKey: "timeControlStatus")
    }
}

@MainActor
private final class Fixture {
    var lookups: [CheckedContinuation<Result<URL?, Error>, Never>] = []
    var deadlines: [CheckedContinuation<Void, Error>] = []
    var players: [PreviewPlayer] = []
    lazy var subject = ApplePreviewPlayer(
        lookup: { [unowned self] _, _ in await withCheckedContinuation { self.lookups.append($0) } },
        makePlayer: { [unowned self] _ in let player = PreviewPlayer(); self.players.append(player); return player },
        sleep: { [unowned self] _ in try await withCheckedThrowingContinuation { self.deadlines.append($0) } }
    )
    func load(autoplay: Bool = false) async {
        let expected = lookups.count + 1
        subject.load(id: "123", storefront: "us", autoplay: autoplay)
        await eventually { self.lookups.count == expected }
    }
    func resolve(_ index: Int) { lookups[index].resume(returning: .success(URL(string: "https://audio.apple.com/preview"))) }
    func attach(_ index: Int, autoplay: Bool = false) async -> PreviewPlayer {
        await load(autoplay: autoplay)
        resolve(index)
        await eventually { self.players.count == index + 1 }
        let player = players[index]
        player.item.report(.readyToPlay)
        await eventually { self.subject.status == (autoplay ? "starting" : "ready") }
        return player
    }
    func expire(_ index: Int) { deadlines[index].resume() }
}

@MainActor
private func eventually(_ predicate: () -> Bool, file: StaticString = #file, line: UInt = #line) async {
    for _ in 0..<200 {
        if predicate() { return }
        try? await Task.sleep(for: .milliseconds(1))
    }
    fatalError("Condition did not settle", file: file, line: line)
}

@MainActor
private func drain() async { for _ in 0..<10 { await Task.yield() }; try? await Task.sleep(for: .milliseconds(5)) }

@main
struct NativePreviewTests {
    @MainActor
    static func main() async {
        // Lookup expiry is terminal, even when the suspended lookup ignores cancellation.
        do {
            let f = Fixture()
            await f.load(autoplay: true)
            await eventually { f.deadlines.count == 1 }
            f.expire(0)
            await eventually { f.subject.status == "error" }
            f.resolve(0)
            await drain()
            precondition(f.players.isEmpty && f.subject.status == "error", "Late lookup autoplayed")
        }
        // Readiness cancels loading; a requested start gets its own bounded deadline.
        do {
            let f = Fixture()
            let p = await f.attach(0, autoplay: true)
            await eventually { f.deadlines.count == 2 }
            f.expire(0)
            await drain()
            precondition(f.subject.status == "starting", "Cancelled loading deadline overwrote startup")
            f.expire(1)
            await eventually { f.subject.status == "error" }
            precondition(p.playCalls == 1 && p.pauseCalls > 0)
            p.report(.playing)
            p.item.report(.readyToPlay)
            await drain()
            precondition(f.subject.status == "error", "Late player event cleared terminal error")
        }
        // A resumed stall is bounded and repeated waiting cannot extend the deadline.
        do {
            let f = Fixture()
            let p = await f.attach(0, autoplay: true)
            await eventually { f.deadlines.count == 2 }
            p.report(.playing)
            await eventually { f.subject.status == "playing" }
            f.expire(0); f.expire(1)
            await drain()
            precondition(f.subject.status == "playing")
            p.report(.waitingToPlayAtSpecifiedRate)
            await eventually { f.deadlines.count == 3 }
            p.report(.waitingToPlayAtSpecifiedRate)
            await drain()
            precondition(f.deadlines.count == 3, "Waiting extended the stall")
            f.expire(2)
            await eventually { f.subject.status == "error" }
        }
        // Pause invalidates pending seek-play and cancels startup expiry.
        do {
            let f = Fixture()
            let p = await f.attach(0)
            f.subject.restart()
            await eventually { f.deadlines.count == 2 }
            f.subject.pause()
            p.seeks[0](true)
            f.expire(0); f.expire(1)
            p.report(.playing)
            await drain()
            precondition(f.subject.status == "paused" && p.playCalls == 0, "Restart undid pause")
        }
        // Restart -> seek transfers intent to the newest seek, keeping the original bound.
        do {
            let f = Fixture()
            let p = await f.attach(0)
            f.subject.restart()
            f.subject.seek(to: 10)
            await eventually { f.deadlines.count == 2 }
            p.seeks[0](true)
            await drain()
            precondition(p.playCalls == 0, "Old restart completion played")
            p.seeks[1](true)
            await eventually { p.playCalls == 1 }
            precondition(f.deadlines.count == 2)
            f.subject.dispose()
            f.expire(0); f.expire(1)
        }
        // Read current control state after the actor hop, not a stale playing snapshot.
        do {
            let f = Fixture()
            let p = await f.attach(0, autoplay: true)
            await eventually { f.deadlines.count == 2 }
            p.report(.playing)
            f.subject.pause()
            f.subject.play()
            p.report(.waitingToPlayAtSpecifiedRate)
            await eventually { f.deadlines.count == 3 }
            await drain()
            precondition(f.subject.status == "starting", "Stale playing snapshot cancelled the new deadline")
            f.expire(2)
            await eventually { f.subject.status == "error" }
            f.expire(0); f.expire(1)
        }
        // Retry protects a new player from old queued KVO, seeks and expiry.
        do {
            let f = Fixture()
            let old = await f.attach(0)
            f.subject.restart()
            await eventually { f.deadlines.count == 2 }
            old.item.report(.failed)
            old.report(.playing)
            await f.load()
            f.resolve(1)
            await eventually { f.players.count == 2 }
            f.players[1].item.report(.readyToPlay)
            await eventually { f.subject.status == "ready" }
            old.seeks[0](true)
            f.expire(0); f.expire(1); f.expire(2)
            await drain()
            precondition(f.subject.status == "ready" && old.playCalls == 0)
            f.subject.dispose()
        }
        // Disposal stops playback and rejects lookup and observation callbacks.
        do {
            let f = Fixture()
            await f.load(autoplay: true)
            await eventually { f.deadlines.count == 1 }
            f.subject.dispose()
            f.resolve(0); f.expire(0)
            await drain()
            precondition(f.players.isEmpty)
        }
        // Destruction alone stops audio when SwiftUI teardown was skipped.
        do {
            let player = PreviewPlayer()
            var attached = false
            var owner: ApplePreviewPlayer? = ApplePreviewPlayer(
                lookup: { _, _ in .success(URL(string: "https://audio.apple.com/preview")) },
                makePlayer: { _ in attached = true; return player }
            )
            weak var weakOwner = owner
            owner?.load(id: "123", storefront: "us", autoplay: true)
            await eventually { attached }
            player.item.report(.readyToPlay)
            await eventually { owner?.status == "starting" }
            owner = nil
            await eventually { weakOwner == nil }
            weakOwner = nil
            precondition(player.pauseCalls > 0, "Destruction did not stop playback")
            player.report(.playing)
            await drain()
        }
        // A snippet reports sound once, stops itself at its length, and a replay reuses the loaded player.
        do {
            let f = Fixture()
            let p = await f.attach(0)
            var audible = 0
            f.subject.snippet(from: 0, lengthMs: 1000) { audible += 1 }
            await eventually { p.seeks.count == 1 }
            precondition(f.subject.status == "starting" && audible == 0 && p.playCalls == 0, "Snippet played before its seek finished")
            p.seeks[0](true)
            await eventually { p.playCalls == 1 }
            precondition(audible == 0, "Snippet was audible before the player played")
            p.report(.playing)
            await eventually { audible == 1 }
            p.report(.waitingToPlayAtSpecifiedRate)
            p.report(.playing)
            await eventually { f.deadlines.count == 3 }
            precondition(audible == 1 && f.subject.status == "playing", "Snippet onset was reported twice")
            let pauses = p.pauseCalls
            f.expire(2)
            await eventually { f.subject.status == "paused" }
            precondition(p.pauseCalls == pauses + 1 && audible == 1, "Snippet did not stop at its length")
            f.expire(1)
            await drain()
            precondition(f.subject.status == "paused", "Cancelled start deadline fired")
            // Replay: same player, no second lookup.
            p.report(.paused)
            var replayed = 0
            f.subject.snippet(from: 0, lengthMs: 5000) { replayed += 1 }
            await eventually { p.seeks.count == 2 }
            p.seeks[1](true)
            await eventually { p.playCalls == 2 }
            p.report(.playing)
            await eventually { replayed == 1 }
            precondition(f.lookups.count == 1 && f.players.count == 1 && audible == 1, "Replay looked the song up again")
            f.subject.dispose()
        }
        // Pause, play and restart cancel a snippet, before or after sound starts.
        do {
            let f = Fixture()
            let p = await f.attach(0)
            var audible = 0
            f.subject.snippet(from: 0, lengthMs: 1000) { audible += 1 }
            await eventually { p.seeks.count == 1 }
            f.subject.pause()
            p.seeks[0](true)
            p.report(.playing)
            await drain()
            precondition(p.playCalls == 0 && audible == 0 && f.subject.status == "paused", "Paused snippet started")
            f.subject.snippet(from: 0, lengthMs: 1000) { audible += 1 }
            await eventually { p.seeks.count == 2 }
            p.report(.paused)
            p.seeks[1](true)
            await eventually { p.playCalls == 1 }
            p.report(.playing)
            await eventually { audible == 1 && f.deadlines.count == 4 }
            f.subject.pause()
            f.subject.play()
            let pauses = p.pauseCalls
            f.expire(3)
            await drain()
            precondition(p.pauseCalls == pauses && f.subject.status == "starting", "Cancelled snippet timer paused the host's play")
            f.subject.restart()
            f.subject.dispose()
        }
        // A newer snippet supersedes the older one's seek, sound report and timer.
        do {
            let f = Fixture()
            let p = await f.attach(0)
            var first = 0, second = 0
            f.subject.snippet(from: 0, lengthMs: 1000) { first += 1 }
            f.subject.snippet(from: 0, lengthMs: 5000) { second += 1 }
            await eventually { p.seeks.count == 2 }
            p.seeks[0](true)
            await drain()
            precondition(p.playCalls == 0, "Superseded snippet seek played")
            p.report(.paused)
            p.seeks[1](true)
            await eventually { p.playCalls == 1 }
            p.report(.playing)
            await eventually { second == 1 && f.deadlines.count == 3 }
            precondition(first == 0, "Superseded snippet reported sound")
            f.subject.snippet(from: 0, lengthMs: 1000) { first += 1 }
            let pauses = p.pauseCalls
            f.expire(2)
            await drain()
            precondition(p.pauseCalls == pauses && f.subject.status == "starting", "Superseded snippet timer fired")
            f.subject.dispose()
        }
        // Disposal cancels a snippet's timer and late seek and playback callbacks.
        do {
            let f = Fixture()
            let p = await f.attach(0)
            var audible = 0
            f.subject.snippet(from: 0, lengthMs: 1000) { audible += 1 }
            await eventually { p.seeks.count == 1 }
            f.subject.dispose()
            p.seeks[0](true)
            p.report(.playing)
            await drain()
            precondition(p.playCalls == 0 && audible == 0, "Disposed snippet played")
            let g = Fixture()
            let q = await g.attach(0)
            g.subject.snippet(from: 0, lengthMs: 1000) { audible += 1 }
            await eventually { q.seeks.count == 1 }
            q.seeks[0](true)
            await eventually { q.playCalls == 1 }
            q.report(.playing)
            await eventually { audible == 1 && g.deadlines.count == 3 }
            g.subject.dispose()
            let pauses = q.pauseCalls
            g.expire(2)
            await drain()
            precondition(q.pauseCalls == pauses, "Disposed snippet timer fired")
        }
        print("Native Apple preview: 13 recovery scenarios passed")
    }
}
