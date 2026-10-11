import AVFoundation
import SwiftUI

/// Live camera preview that reports each scanned QR payload. Resolution against the deck happens elsewhere.
struct ScannerView: View {
    let onPayload: (String) -> Void
    @StateObject private var scanner = QRScanner()

    init(onPayload: @escaping (String) -> Void) {
        self.onPayload = onPayload
    }

    var body: some View {
        ZStack {
            Color.black
            if scanner.state == .running || scanner.state == .requesting {
                CameraPreview(session: scanner.session)
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(.white.opacity(0.85), lineWidth: 3)
                    .aspectRatio(1, contentMode: .fit)
                    .padding(48)
                    .accessibilityHidden(true)
            } else {
                Text(message)
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .padding()
            }
        }
        .task {
            scanner.onPayload = onPayload
            await scanner.start()
        }
        .onDisappear { scanner.stop() }
    }

    private var message: String {
        switch scanner.state {
        case .denied: return "Camera access is off. Allow it for Eratic in Settings to scan cards."
        case .noCamera: return "No camera is available on this device."
        default: return ""
        }
    }
}

#if os(iOS)
import UIKit

private struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession

    /// Keeps the preview upright as the interface rotates, through the camera's rotation coordinator.
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
        private var coordinator: AVCaptureDevice.RotationCoordinator?
        private var observation: NSKeyValueObservation?

        override func layoutSubviews() {
            super.layoutSubviews()
            attachRotationCoordinator()
        }

        /// The camera input is added once access is granted, so this retries until it exists.
        func attachRotationCoordinator() {
            guard coordinator == nil,
                  let device = previewLayer.session?.inputs.lazy.compactMap({ ($0 as? AVCaptureDeviceInput)?.device }).first else { return }
            let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: previewLayer)
            self.coordinator = coordinator
            apply(coordinator.videoRotationAngleForHorizonLevelPreview)
            observation = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { [weak self] coordinator, _ in
                let angle = coordinator.videoRotationAngleForHorizonLevelPreview
                DispatchQueue.main.async { self?.apply(angle) }
            }
        }

        private func apply(_ angle: CGFloat) {
            guard let connection = previewLayer.connection, connection.isVideoRotationAngleSupported(angle) else { return }
            connection.videoRotationAngle = angle
        }
    }

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.previewLayer.session = session
        view.previewLayer.videoGravity = .resizeAspectFill
        return view
    }

    func updateUIView(_ view: PreviewView, context: Context) {
        view.attachRotationCoordinator()
    }
}
#else
import AppKit

private struct CameraPreview: NSViewRepresentable {
    let session: AVCaptureSession

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        view.wantsLayer = true
        let layer = AVCaptureVideoPreviewLayer(session: session)
        layer.videoGravity = .resizeAspectFill
        layer.autoresizingMask = [.layerWidthSizable, .layerHeightSizable]
        view.layer = layer
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {}
}
#endif
