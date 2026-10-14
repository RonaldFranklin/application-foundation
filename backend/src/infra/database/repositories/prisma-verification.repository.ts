import {
  VerificationChallenge,
  VerificationRepository,
} from "../../../application/email-verification/ports";
import { QueryClient, persist } from "./records";
export class PrismaVerificationRepository implements VerificationRepository {
  constructor(private db: QueryClient) {}
  forUser(userId: string) {
    return persist(() =>
      this.db.emailVerification.findUnique({ where: { userId } }),
    );
  }
  find(id: string) {
    return persist(() =>
      this.db.emailVerification.findUnique({ where: { id } }),
    );
  }
  async save(challenge: VerificationChallenge) {
    await persist(() =>
      this.db.emailVerification.upsert({
        where: { userId: challenge.userId },
        create: challenge,
        update: challenge,
      }),
    );
  }
  async invalidate(userId: string, now: Date) {
    await persist(() =>
      this.db.emailVerification.updateMany({
        where: { userId },
        data: { digest: null, consumedAt: now },
      }),
    );
  }
}
