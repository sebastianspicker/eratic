@preconcurrency import AVFoundation
import Foundation
import Vision

/// Camera QR reader. Payloads are delivered on the main actor, de-duplicated within 2 s.
@MainActor
final class QRScanner: NSObject, ObservableObject {
    enum State: Equatable {
        case idle
        case requesting
        case running
        case denied
        case noCamera
    }

    @Published private(set) var state = State.idle
    let session = AVCaptureSession()
    var onPayload: ((String) -> Void)?

    private let queue = DispatchQueue(label: "eratic.scanner")
    private let output = AVCaptureVideoDataOutput()
    private var configured = false
    private var lastPayload: String?
    private var lastDelivery = ContinuousClock.Instant.now
    /// Cleared by `stop()`, so a permission prompt answered after the view closed can't start the camera.
    private var wantsRunning = false

    func start() async {
        wantsRunning = true
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            state = .requesting
            guard await AVCaptureDevice.requestAccess(for: .video) else { state = .denied; return }
        default:
            state = .denied
            return
        }
        guard wantsRunning, !Task.isCancelled else { state = .idle; return }
        guard configureIfNeeded() else { state = .noCamera; return }
        let session = session
        queue.async { if !session.isRunning { session.startRunning() } }
        state = .running
    }

    func stop() {
        wantsRunning = false
        let session = session
        queue.async { if session.isRunning { session.stopRunning() } }
        if state == .running { state = .idle }
    }

    private func configureIfNeeded() -> Bool {
        if configured { return true }
        #if os(iOS)
        let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(for: .video)
        #else
        let device = AVCaptureDevice.default(for: .video)
        #endif
        guard let device, let input = try? AVCaptureDeviceInput(device: device) else { return false }
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        guard session.canAddInput(input), session.canAddOutput(output) else { return false }
        session.addInput(input)
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: queue)
        session.addOutput(output)
        configured = true
        return true
    }

    private func deliver(_ payload: String) {
        let now = ContinuousClock.now
        if payload == lastPayload, now - lastDelivery < .seconds(2) { return }
        lastPayload = payload
        lastDelivery = now
        onPayload?(payload)
    }
}

extension QRScanner: AVCaptureVideoDataOutputSampleBufferDelegate {
    nonisolated func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let request = VNDetectBarcodesRequest()
        request.symbologies = [.qr]
        let handler = VNImageRequestHandler(cvPixelBuffer: buffer, orientation: .up, options: [:])
        guard (try? handler.perform([request])) != nil else { return }
        guard let payload = request.results?.compactMap(\.payloadStringValue).first else { return }
        Task { @MainActor [weak self] in self?.deliver(payload) }
    }
}
