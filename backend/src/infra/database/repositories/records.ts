import { Prisma, User } from "@prisma/client";
import {
  UserRecord,
  SessionWithUser,
  DeviceWithUser,
} from "../../../domain/auth/models";
export type QueryClient = Prisma.TransactionClient;
export async function persist<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new Error("Falha de persistência.");
  }
}
export function userRecord(row: User): UserRecord {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    usernameIndex: row.usernameIndex,
    emailIndex: row.emailIndex,
    master: row.master,
    passwordHash: row.passwordHash,
    mustChangePassword: row.mustChangePassword,
    totpSecret: row.totpSecret,
    totpVerified: row.totpVerified,
    lastTotpStep: row.lastTotpStep,
    createdAt: row.createdAt,
  };
}
export function sessionRecord(
  row: Prisma.SessionGetPayload<{ include: { user: true } }>,
): SessionWithUser {
  return {
    digest: row.digest,
    userId: row.userId,
    stage: row.stage,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    user: userRecord(row.user),
  };
}
export function deviceRecord(
  row: Prisma.MasterDeviceGetPayload<{ include: { user: true } }>,
): DeviceWithUser {
  return {
    digest: row.digest,
    userId: row.userId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    user: userRecord(row.user),
  };
}
