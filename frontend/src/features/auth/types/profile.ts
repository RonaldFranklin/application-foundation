export interface AccountProfile {
  username: string;
  email: string;
  accountType: "common" | "master";
  mfa: { configured: boolean; verified: boolean };
}
