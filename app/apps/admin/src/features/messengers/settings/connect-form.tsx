import { useEffect, useId, useReducer, useState, type FormEvent } from "react";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { Field } from "@hub/ui/product/field";
import { useClock } from "@/lib/clock";
import { useTelegramLogin } from "@/lib/data/messengers";
import { QrCode } from "./qr-code";

/** Said once on the form (decision 0036 point 2): the account is his own, and the risk is his. */
export const RISK_SENTENCE =
  "This connects your own, personal Telegram account as an unofficial client. Telegram may watch such logins and can ban the account. The Hub reads only the chats you link, never sends by itself, and stops the account at the first warning.";

const onSubmit = (go: () => void) => (e: FormEvent) => {
  e.preventDefault();
  go();
};

/**
 * Settings ▸ Messengers, connect a Telegram account (P71 M3 over M1's routes): the risk sentence, then one step at a time, each a
 * server call that keeps nothing but the final session: api_id and api_hash from my.telegram.org, then either a phone and code
 * or a QR code scanned in Telegram, then the 2FA password if the account has one. He types every value himself; the agent never does (0036
 * point 4). A refusal is said in the alert and the form stays on its step.
 */
export function ConnectForm() {
  const login = useTelegramLogin();
  const ids = { apiId: useId(), apiHash: useId(), phone: useId(), code: useId(), password: useId() };
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const clock = useClock();
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const s = login.state;
  useEffect(() => {
    if (s.step !== "qr") return;
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [s.step]);
  const qrExpired = s.step === "qr" && s.expiresAt !== null && Date.parse(s.expiresAt) <= clock();
  const cancel = (
    <ActionButton disabled={login.busy} onClick={() => void login.cancel().then(() => { setCode(""); setPassword(""); })} size="s" variant="quiet">
      Cancel
    </ActionButton>
  );
  return (
    <div className="flex flex-col gap-3" data-testid="telegram-connect">
      <p className="measure text-sm">{RISK_SENTENCE}</p>
      {s.step === "start" && (
        <form className="flex flex-col gap-3" onSubmit={onSubmit(() => void login.start({ apiId: Number(apiId), apiHash: apiHash.trim(), phone: phone.trim() }))}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field hint="From my.telegram.org ▸ API development tools." htmlFor={ids.apiId} label="api_id">
              <Input autoComplete="off" className="control-m" id={ids.apiId} inputMode="numeric" onChange={(e) => setApiId(e.target.value)} value={apiId} />
            </Field>
            <Field hint="32 characters, from the same page." htmlFor={ids.apiHash} label="api_hash">
              <Input autoComplete="off" className="control-m" id={ids.apiHash} onChange={(e) => setApiHash(e.target.value)} spellCheck={false} type="password" value={apiHash} />
            </Field>
          </div>
          <Field hint="For a code sent by Telegram. You do not need a phone number to scan a QR code." htmlFor={ids.phone} label="Phone">
            <Input autoComplete="off" className="control-m sm:w-64" id={ids.phone} inputMode="tel" onChange={(e) => setPhone(e.target.value)} value={phone} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <ActionButton disabled={login.busy || !/^\d+$/.test(apiId) || apiHash.trim() === "" || phone.trim() === ""} size="s" type="submit" variant="primary">
              {login.busy ? "Asking Telegram" : "Send me the code"}
            </ActionButton>
            <ActionButton
              disabled={login.busy || !/^\d+$/.test(apiId) || apiHash.trim() === ""}
              onClick={() => void login.start({ apiId: Number(apiId), apiHash: apiHash.trim(), method: "qr" })}
              size="s"
              type="button"
              variant="quiet"
            >
              Sign in with QR code
            </ActionButton>
          </div>
        </form>
      )}
      {s.step === "qr" && (
        <div className="flex flex-col gap-3">
          {s.qr && !qrExpired ? (
            <QrCode label="QR code to scan with Telegram on your phone" rows={s.qr} />
          ) : (
            <p className="text-muted-foreground text-sm" role="status">Waiting for a fresh QR code from Telegram...</p>
          )}
          <p className="measure text-sm">On your phone open Telegram ▸ Settings ▸ Devices ▸ Link Desktop Device, then scan this code. A fresh code appears automatically when it expires.</p>
          <div>{cancel}</div>
        </div>
      )}
      {s.step === "code" && (
        <form className="flex flex-col gap-3" onSubmit={onSubmit(() => void login.code(code))}>
          <Field hint="Telegram sent it to your app (or by SMS)." htmlFor={ids.code} label="Code">
            <Input autoComplete="one-time-code" className="control-m sm:w-48" id={ids.code} inputMode="numeric" onChange={(e) => setCode(e.target.value)} value={code} />
          </Field>
          <div className="flex gap-2">
            <ActionButton disabled={login.busy || code.trim() === ""} size="s" type="submit" variant="primary">
              {login.busy ? "Checking" : "Continue"}
            </ActionButton>
            {cancel}
          </div>
        </form>
      )}
      {s.step === "password" && (
        <form className="flex flex-col gap-3" onSubmit={onSubmit(() => void login.password(password))}>
          <Field hint="Your account has a two-step verification password." htmlFor={ids.password} label="Password">
            <Input autoComplete="current-password" className="control-m sm:w-64" id={ids.password} onChange={(e) => setPassword(e.target.value)} type="password" value={password} />
          </Field>
          <div className="flex gap-2">
            <ActionButton disabled={login.busy || password === ""} size="s" type="submit" variant="primary">
              {login.busy ? "Checking" : "Connect"}
            </ActionButton>
            {cancel}
          </div>
        </form>
      )}
      <div className="min-h-5 text-sm">
        <p role="status">{s.step === "done" ? `Connected as ${s.name}.` : ""}</p>
        <p className="text-destructive-foreground" role="alert">
          {login.alert ?? ""}
        </p>
      </div>
    </div>
  );
}
