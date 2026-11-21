import { cancelTelegramUserLogin, disconnectTelegramUser, getTelegramUserLoginStatus, getTelegramUserStatus, sendTelegramUserCode, sendTelegramUserPassword, startTelegramUserLogin } from "@hub/api";
import { telegramUserStatusDto, userLoginCancelledDto, userDisconnectedDto, userLoginStepDto, type UserLoginStartBody } from "@hub/contract/messengers";
import { readGenerated } from "../client";

/**
 * The owner's Telegram user account (P71 M1's routes, decision 0036 point 4), driven by Settings ▸ Messengers: its state, the
 * login one step per call (api_id and api_hash, then a phone and code or a QR code, then the 2FA password if Telegram asks), Disconnect. The api_hash, the phone, the code and the password are arguments of these calls and go nowhere else:
 * not into a query key, a mutation's variables or the address; no reply carries one (the contract has no field for it).
 */
export const telegramUserApi = {
  status: () => readGenerated(getTelegramUserStatus(), telegramUserStatusDto),
  start: (body: UserLoginStartBody) => readGenerated(startTelegramUserLogin(body), userLoginStepDto),
  loginStatus: (flow: string) => readGenerated(getTelegramUserLoginStatus({ flow }), userLoginStepDto),
  code: (flow: string, code: string) => readGenerated(sendTelegramUserCode({ flow, code }), userLoginStepDto),
  password: (flow: string, password: string) => readGenerated(sendTelegramUserPassword({ flow, password }), userLoginStepDto),
  cancel: (flow: string) => readGenerated(cancelTelegramUserLogin({ flow }), userLoginCancelledDto),
  disconnect: (account: string) => readGenerated(disconnectTelegramUser(account), userDisconnectedDto),
};
