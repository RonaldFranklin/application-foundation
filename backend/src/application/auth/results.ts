import { Stage } from "../../domain/auth/models";
export const INVALID = "E-mail ou senha inválidos.";
export interface SessionGrant {
  raw: string;
  stage: Stage;
  seconds: number;
  deviceRaw?: string;
}
export interface AccountProfile {
  message: string;
  username: string;
  email: string;
  accountType: "common" | "master";
  mfa: { configured: boolean; verified: boolean };
}
export type Busy = { busy: true };
export type InvalidInput = {
  invalid: "password" | "initial-password" | "logout";
};
export type LoginResult =
  | Busy
  | { ok: false; challengeRequired: boolean }
  | (SessionGrant & { ok: true });
export type IssueResult =
  | Busy
  | InvalidInput
  | null
  | (SessionGrant & { ok?: true; recoveryCodes?: string[] })
  | { secret: string; uri: string }
  | AccountProfile
  | { stage: string; master: boolean };
