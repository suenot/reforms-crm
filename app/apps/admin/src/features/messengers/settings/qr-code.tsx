import { qrPath, qrSide } from "./whatsapp/qr";

/** Draw module rows on white so the phone can scan them in either theme. */
export function QrCode({ label, rows }: { label: string; rows: readonly string[] }) {
  const side = qrSide(rows.length);
  return (
    <svg aria-label={label} className="size-56 rounded-md bg-white" role="img" shapeRendering="crispEdges" viewBox={`0 0 ${side} ${side}`}>
      <path d={qrPath(rows)} fill="#000" />
    </svg>
  );
}
