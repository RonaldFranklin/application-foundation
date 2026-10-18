export interface Customer {
  id: string;
  organizationId: string;
  email: string;
  emailIndex: string;
  name: string | null;
  status: string;
  passwordHash: string | null;
  emailVerifiedAt: Date | null;
  totpSecret: string | null;
  pendingTotpSecret: string | null;
  pendingTotpExpiresAt: Date | null;
  lastTotpStep: bigint;
  createdAt: Date;
}
export interface CustomerSession {
  digest: string;
  publicId: string;
  customerId: string;
  stage: string;
  expiresAt: Date;
  createdAt: Date;
}
export interface CustomerToken {
  attempts: number;
  id: string;
  customerId: string;
  kind: string;
  digest: string;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}
