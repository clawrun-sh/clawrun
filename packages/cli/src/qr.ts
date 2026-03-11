import qrcode from "qrcode-terminal";

/** Generate a QR code string for the given URL. */
export function generateQR(url: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(url, { small: true }, (code: string) => {
      resolve(code);
    });
  });
}
