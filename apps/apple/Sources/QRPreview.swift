import SwiftUI
import CoreImage.CIFilterBuiltins

struct QRPreview: View {
    let payload: String
    var size: CGFloat = 220
    var label = "QR code for the selected card route"

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
                .frame(width: size, height: size)
                .padding(size * 32 / 220)
                .background(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .accessibilityLabel(label)
        } else {
            Text("QR preview could not be generated.").foregroundStyle(.secondary)
        }
    }
}
