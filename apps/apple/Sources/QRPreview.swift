import SwiftUI
import CoreImage.CIFilterBuiltins

struct QRPreview: View {
    let payload: String

    private var image: CGImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(payload.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        return CIContext().createCGImage(output, from: output.extent)
    }

    var body: some View {
        if let image {
            Image(decorative: image, scale: 1)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .frame(width: 220, height: 220)
                .padding(32)
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel("QR code for the selected card route")
        } else {
            Text("QR preview could not be generated.").foregroundStyle(.secondary)
        }
    }
}
