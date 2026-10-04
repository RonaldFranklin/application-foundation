import { SessionRepository } from "../../../application/auth/ports/repositories";
import {
  SessionRecord,
  SessionWithUser,
  DeviceWithUser,
} from "../../../domain/auth/models";
import { QueryClient, persist, sessionRecord, deviceRecord } from "./records";
export class PrismaSessionRepository implements SessionRepository {
  constructor(private db: QueryClient) {}
  find(digest: string): Promise<SessionWithUser | null> {
    return persist(async () => {
      const row = await this.db.session.findUnique({
        where: { digest },
        include: { user: true },
      });
      return row ? sessionRecord(row) : null;
    });
  }
  create(data: Omit<SessionRecord, "createdAt">): Promise<void> {
    return persist(async () => {
      await this.db.session.create({ data });
    });
  }
  delete(digest: string): Promise<void> {
    return persist(async () => {
      await this.db.session.deleteMany({ where: { digest } });
    });
  }
  deleteForUser(userId: string): Promise<void> {
    return persist(async () => {
      await this.db.session.deleteMany({ where: { userId } });
    });
  }
  findDevice(digest: string): Promise<DeviceWithUser | null> {
    return persist(async () => {
      const row = await this.db.masterDevice.findUnique({
        where: { digest },
        include: { user: true },
      });
      return row ? deviceRecord(row) : null;
    });
  }
  createDevice(data: {
    digest: string;
    userId: string;
    expiresAt: Date;
  }): Promise<void> {
    return persist(async () => {
      await this.db.masterDevice.create({ data });
    });
  }
  deleteDevice(digest: string, userId?: string): Promise<void> {
    return persist(async () => {
      await this.db.masterDevice.deleteMany({
        where: { digest, ...(userId === undefined ? {} : { userId }) },
      });
    });
  }
  deleteDevicesForUser(userId: string): Promise<void> {
    return persist(async () => {
      await this.db.masterDevice.deleteMany({ where: { userId } });
    });
  }
  deviceDigestsAfter(userId: string, count: number): Promise<string[]> {
    return persist(async () =>
      (
        await this.db.masterDevice.findMany({
          where: { userId },
          orderBy: [{ createdAt: "desc" }, { digest: "asc" }],
          skip: count,
          select: { digest: true },
        })
      ).map((d) => d.digest),
    );
  }
  deleteDevices(digests: string[]): Promise<void> {
    return persist(async () => {
      await this.db.masterDevice.deleteMany({
        where: { digest: { in: digests } },
      });
    });
  }
  deleteExpiredSessions(before: Date): Promise<void> {
    return persist(async () => {
      await this.db.session.deleteMany({
        where: { expiresAt: { lt: before } },
      });
    });
  }
  deleteExpiredDevices(before: Date): Promise<void> {
    return persist(async () => {
      await this.db.masterDevice.deleteMany({
        where: { expiresAt: { lt: before } },
      });
    });
  }
}
