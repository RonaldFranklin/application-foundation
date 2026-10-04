import { RateRepository } from "../../../application/auth/ports/repositories";
import { RateRecord } from "../../../domain/auth/models";
import { QueryClient, persist } from "./records";
export class PrismaRateRepository implements RateRepository {
  constructor(private db: QueryClient) {}
  find(key: string): Promise<RateRecord | null> {
    return persist(async () => {
      const row = await this.db.rateState.findUnique({ where: { key } });
      return row
        ? { hits: row.hits, cycles: row.cycles, blockedUntil: row.blockedUntil }
        : null;
    });
  }
  saveHits(key: string, hits: Date[]): Promise<void> {
    return persist(async () => {
      await this.db.rateState.upsert({
        where: { key },
        create: { key, hits },
        update: { hits },
      });
    });
  }
  save(key: string, state: RateRecord): Promise<void> {
    return persist(async () => {
      await this.db.rateState.upsert({
        where: { key },
        create: { key, ...state },
        update: state,
      });
    });
  }
  delete(key: string): Promise<void> {
    return persist(async () => {
      await this.db.rateState.deleteMany({ where: { key } });
    });
  }
  deleteInactive(updatedBefore: Date, blockedBefore: Date): Promise<void> {
    return persist(async () => {
      await this.db.rateState.deleteMany({
        where: {
          updatedAt: { lt: updatedBefore },
          OR: [{ blockedUntil: null }, { blockedUntil: { lt: blockedBefore } }],
        },
      });
    });
  }
}
