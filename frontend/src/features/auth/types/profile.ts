export interface AccountProfile {
  username: string;
  email: string;
  emailVerifiedAt: string | null;
  accountType: "common" | "master";
  mfa: { configured: boolean; verified: boolean };
}
