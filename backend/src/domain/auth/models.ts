export type Stage = "password" | "setup" | "mfa" | "recovery" | "full";
export interface UserRecord {
  id: string;
  username: string;
  email: string;
  emailVerifiedAt: Date | null;
  usernameIndex: string;
  emailIndex: string;
  master: boolean;
  passwordHash: string;
  mustChangePassword: boolean;
  totpSecret: string | null;
  totpVerified: boolean;
  lastTotpStep: bigint;
  createdAt: Date;
}
export interface SessionRecord {
  digest: string;
  userId: string;
  stage: string;
  expiresAt: Date;
  createdAt: Date;
}
export interface SessionWithUser extends SessionRecord {
  user: UserRecord;
}
export interface DeviceRecord {
  digest: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
}
export interface DeviceWithUser extends DeviceRecord {
  user: UserRecord;
}
export interface RateRecord {
  hits: Date[];
  cycles: number;
  blockedUntil: Date | null;
}
