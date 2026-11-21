/**
 * A messenger pairing QR code as one SVG path (P71 M5): the server sends the module rows (`0` and `1`), never the QR string,
 * and the admin draws them, so no image or QR library is a dependency here. Pure, so a test holds it.
 */

/** A quiet zone of four modules on every side, as the QR standard asks, so a phone camera finds the code on any background. */
export const QR_MARGIN = 4;

/** One `M x y h1v1h-1z` square per dark module, offset by the margin. */
export function qrPath(rows: readonly string[]): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "1") d += `M${x + QR_MARGIN} ${y + QR_MARGIN}h1v1h-1z`;
  });
  return d;
}

/** The SVG's side in modules: the code and both margins. */
export const qrSide = (size: number): number => size + 2 * QR_MARGIN;
