import { ActionButton } from "@hub/ui/product/action-button";
import { Skeleton } from "@hub/ui/skeleton";
import { QueryView } from "@/components/state-views";
import { AccountRow } from "../account-row";
import { useWhatsApp, useWhatsAppConnect } from "@/lib/data/messengers";
import { QrCode } from "../qr-code";

/** Said once above Connect (decision 0036 point 2), as the Telegram form's: the number is his own, and the risk is his. */
export const WA_RISK_SENTENCE =
  "This links your own, personal WhatsApp number as an unofficial device, like WhatsApp Web. WhatsApp may watch such clients and can ban the number. The Hub reads only the chats you link, never sends by itself, and stops the number at the first warning.";

/** Connect: the risk sentence, then the button; on the owner's click the QR code with how to scan it, until it is scanned. */
function ConnectWhatsApp() {
  const c = useWhatsAppConnect();
  return (
    <div className="flex flex-col gap-3" data-testid="whatsapp-connect">
      <p className="measure text-sm">{WA_RISK_SENTENCE}</p>
      {c.active ? (
        <div className="flex flex-col gap-3">
          {c.qr ? (
            <>
              <QrCode label="QR code to scan with WhatsApp on your phone" rows={c.qr.rows} />
              <p className="measure text-sm">On your phone open WhatsApp ▸ Settings ▸ Linked devices ▸ Link a device, and scan this code. A new code shows about every 20 seconds.</p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">Waiting for WhatsApp...</p>
          )}
          <div>
            <ActionButton onClick={() => void c.cancel()} size="s" variant="quiet">
              Cancel
            </ActionButton>
          </div>
        </div>
      ) : (
        <div>
          <ActionButton disabled={c.busy} onClick={() => void c.connect()} size="s" variant="primary">
            {c.busy ? "Asking WhatsApp" : "Connect"}
          </ActionButton>
        </div>
      )}
      <div className="min-h-5 text-sm">
        <p role="status">{c.done ?? ""}</p>
        <p className="text-destructive-foreground" role="alert">
          {c.alert ?? ""}
        </p>
      </div>
    </div>
  );
}

/**
 * Settings ▸ Messengers, WhatsApp (P71 M5): the linked number with its state and Disconnect, or Connect with its risk sentence
 * and, on his click, the QR code to scan. When the server keeps WhatsApp off (`HUB_MESSENGERS=off`, several projects) its reason
 * is the one line above; Connect still asks the server, whose refusal lands in the alert.
 */
export function WhatsAppAccount({ linked }: { linked?: number }) {
  const q = useWhatsApp();
  return (
    <QueryView loading={<Skeleton className="h-24 w-full rounded-xl" />} query={q} what="WhatsApp">
      {(d) => <WhatsAppAccountBody d={d} linked={linked} />}
    </QueryView>
  );
}

/** The linked numbers, or Connect (the block above owns the read and its states). */
function WhatsAppAccountBody({ d, linked }: { d: NonNullable<ReturnType<typeof useWhatsApp>["data"]>; linked?: number }) {
  // P141 W3 (decision 0049 point 4): when the server cannot read the Mac's WhatsApp app, the row says why and the one fix.
  const app = d.appHistory;
  if (d.accounts.length > 0)
    return (
      <div className="flex flex-col gap-2">
        <ul aria-label="WhatsApp numbers" className="flex flex-col divide-y border-y">
          {d.accounts.map((a) => (
            <AccountRow
              a={a}
              channel="whatsapp"
              linked={linked}
              key={a.account}
              label={`WhatsApp +${a.account}`}
              note="The device is unlinked (it leaves Linked devices on your phone) and its keys are deleted; the linked chats and their messages stay. To read them again, connect and scan a new code."
            />
          ))}
        </ul>
        {app?.state === "off" && (
          <p className="text-muted-foreground text-sm" data-testid="whatsapp-app-history">
            {app.detail} Messages are kept {app.cacheDays} days.{app.fix ? ` ${app.fix}` : ""}
          </p>
        )}
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      {d.state === "off" && d.reason && <p className="text-muted-foreground text-sm">WhatsApp is off on this server: {d.reason}.</p>}
      <ConnectWhatsApp />
    </div>
  );
}
