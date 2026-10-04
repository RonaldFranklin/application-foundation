import {
  UserRecord,
  SessionRecord,
  SessionWithUser,
  DeviceWithUser,
  RateRecord,
} from "../../../domain/auth/models";
export type NewUser = Pick<
  UserRecord,
  | "username"
  | "email"
  | "usernameIndex"
  | "emailIndex"
  | "passwordHash"
  | "master"
  | "mustChangePassword"
>;
export type CredentialUpdate = Partial<
  Pick<
    UserRecord,
    | "username"
    | "email"
    | "usernameIndex"
    | "emailIndex"
    | "passwordHash"
    | "mustChangePassword"
    | "totpSecret"
    | "totpVerified"
    | "lastTotpStep"
  >
>;
export interface IdentityRepository {
  findMaster(): Promise<UserRecord | null>;
  findByIndex(index: string, master: boolean): Promise<UserRecord | null>;
  findCollision(
    usernameIndex: string,
    emailIndex: string,
    excludeId?: string,
  ): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  requireById(id: string): Promise<UserRecord>;
  create(user: NewUser): Promise<void>;
  updateCredentials(id: string, changes: CredentialUpdate): Promise<void>;
  consumeRecovery(userId: string, digest: string): Promise<number>;
  deleteRecovery(userId: string): Promise<void>;
  createRecovery(userId: string, digests: string[]): Promise<void>;
}
export interface SessionRepository {
  find(digest: string): Promise<SessionWithUser | null>;
  create(session: Omit<SessionRecord, "createdAt">): Promise<void>;
  delete(digest: string): Promise<void>;
  deleteForUser(userId: string): Promise<void>;
  findDevice(digest: string): Promise<DeviceWithUser | null>;
  createDevice(device: {
    digest: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void>;
  deleteDevice(digest: string, userId?: string): Promise<void>;
  deleteDevicesForUser(userId: string): Promise<void>;
  deviceDigestsAfter(userId: string, count: number): Promise<string[]>;
  deleteDevices(digests: string[]): Promise<void>;
  deleteExpiredSessions(before: Date): Promise<void>;
  deleteExpiredDevices(before: Date): Promise<void>;
}
export interface RateRepository {
  find(key: string): Promise<RateRecord | null>;
  saveHits(key: string, hits: Date[]): Promise<void>;
  save(key: string, state: RateRecord): Promise<void>;
  delete(key: string): Promise<void>;
  deleteInactive(updatedBefore: Date, blockedBefore: Date): Promise<void>;
}
export interface AuthRepositories {
  identities: IdentityRepository;
  sessions: SessionRepository;
  rates: RateRepository;
}
export interface AuthTransaction extends AuthRepositories {
  lock(key: string): Promise<void>;
}
export interface UnitOfWork<
  Transaction extends AuthTransaction = AuthTransaction,
> {
  run<T>(
    work: (tx: Transaction) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T>;
}
