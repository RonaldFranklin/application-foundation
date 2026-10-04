export type Stage = "login" | "password" | "setup" | "mfa" | "recovery";
export type SessionState = {
  stage: Exclude<Stage, "login"> | "full";
  master: boolean;
};
export type AuthResult = {
  stage?: SessionState["stage"];
  recoveryCodes?: string[];
  secret?: string;
};
