export interface AccountProfile {
  username: string;
  email: string;
  emailVerifiedAt: string | null;
  accountType: "common" | "master" | "platform-admin";
  platformPermissions?: string[];
  mfa: { configured: boolean; verified: boolean };
}
