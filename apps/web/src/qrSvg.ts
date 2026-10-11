import QRCode from "qrcode";
// schnitzelburger/hitster-cards inspired a QR/print boundary, without copying code.
// Printing is a future consumer of the SVG; no duplex settings are inferred here.
export const QR_QUIET_ZONE_MODULES = 4;
export async function renderQR(payload: string): Promise<string> {
  return QRCode.toString(payload, {
    type: "svg",
    margin: QR_QUIET_ZONE_MODULES,
    errorCorrectionLevel: "M",
    color: { dark: "#000000", light: "#ffffff" },
  });
}
