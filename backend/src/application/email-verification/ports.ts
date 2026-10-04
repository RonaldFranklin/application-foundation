import { AuthTransaction } from "../auth/ports/repositories";
export interface VerificationChallenge {
  userId: string;
  id: string;
  digest: string | null;
  emailFingerprint: string;
  expiresAt: Date;
  attempts: number;
  consumedAt: Date | null;
  deliveredAt: Date | null;
  requests: Date[];
}
export interface VerificationRepository {
  forUser(userId: string): Promise<VerificationChallenge | null>;
  find(id: string): Promise<VerificationChallenge | null>;
  save(challenge: VerificationChallenge): Promise<void>;
  invalidate(userId: string, now: Date): Promise<void>;
}
export interface VerificationTransaction extends AuthTransaction {
  verifications: VerificationRepository;
}
export interface VerificationJob {
  challengeId: string;
  encryptedCode: string;
}
export interface VerificationPublisher {
  publish(job: VerificationJob): Promise<void>;
}
export interface VerificationSecrets {
  generate(): { id: string; code: string };
  digest(code: string, context: string): string;
  matches(code: string, context: string, digest: string): boolean;
  encrypt(code: string, context: string): string;
  decrypt(envelope: string, context: string): string;
}
export const verificationContext = (
  c: Pick<VerificationChallenge, "id" | "userId" | "emailFingerprint">,
) => JSON.stringify([c.id, c.userId, c.emailFingerprint]);
