import qrcode from "qrcode-generator";

/** Convert a short-lived login URL to QR modules without exposing the URL in an API reply. */
export function qrRows(text: string): { size: number; rows: string[] } {
  const qr = qrcode(0, "L");
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  const rows: string[] = [];
  for (let r = 0; r < size; r++) {
    let row = "";
    for (let c = 0; c < size; c++) row += qr.isDark(r, c) ? "1" : "0";
    rows.push(row);
  }
  return { size, rows };
}
