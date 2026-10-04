import {
  IdentityRepository,
  NewUser,
  CredentialUpdate,
} from "../../../application/auth/ports/repositories";
import { UserRecord } from "../../../domain/auth/models";
import { QueryClient, persist, userRecord } from "./records";
export class PrismaIdentityRepository implements IdentityRepository {
  constructor(private db: QueryClient) {}
  findMaster(): Promise<UserRecord | null> {
    return persist(async () => {
      const row = await this.db.user.findFirst({ where: { master: true } });
      return row ? userRecord(row) : null;
    });
  }
  findByIndex(index: string, master: boolean): Promise<UserRecord | null> {
    return persist(async () => {
      const row = await this.db.user.findFirst({
        where: {
          master,
          OR: [{ usernameIndex: index }, { emailIndex: index }],
        },
      });
      return row ? userRecord(row) : null;
    });
  }
  findCollision(
    usernameIndex: string,
    emailIndex: string,
    excludeId?: string,
  ): Promise<UserRecord | null> {
    return persist(async () => {
      const row = await this.db.user.findFirst({
        where: {
          ...(excludeId ? { id: { not: excludeId } } : {}),
          OR: [
            { usernameIndex },
            { emailIndex },
            { usernameIndex: emailIndex },
            { emailIndex: usernameIndex },
          ],
        },
      });
      return row ? userRecord(row) : null;
    });
  }
  findById(id: string): Promise<UserRecord | null> {
    return persist(async () => {
      const row = await this.db.user.findUnique({ where: { id } });
      return row ? userRecord(row) : null;
    });
  }
  requireById(id: string): Promise<UserRecord> {
    return persist(async () =>
      userRecord(await this.db.user.findUniqueOrThrow({ where: { id } })),
    );
  }
  create(data: NewUser): Promise<void> {
    return persist(async () => {
      await this.db.user.create({ data });
    });
  }
  updateCredentials(id: string, data: CredentialUpdate): Promise<void> {
    return persist(async () => {
      await this.db.user.update({ where: { id }, data });
    });
  }
  consumeRecovery(userId: string, digest: string): Promise<number> {
    return persist(
      async () =>
        (await this.db.recoveryCode.deleteMany({ where: { userId, digest } }))
          .count,
    );
  }
  deleteRecovery(userId: string): Promise<void> {
    return persist(async () => {
      await this.db.recoveryCode.deleteMany({ where: { userId } });
    });
  }
  createRecovery(userId: string, digests: string[]): Promise<void> {
    return persist(async () => {
      await this.db.recoveryCode.createMany({
        data: digests.map((digest) => ({ userId, digest })),
      });
    });
  }
}
