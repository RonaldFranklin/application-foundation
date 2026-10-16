import { OrganizationContextRepository } from "../../../application/organizations/ports/context.repository";
import { QueryClient, persist } from "./records";
export class PrismaOrganizationContextRepository implements OrganizationContextRepository {
  constructor(private db: QueryClient) {}
  set(digest: string, activeOrganization: string) {
    return persist(
      async () =>
        (
          await this.db.session.updateMany({
            where: { digest },
            data: { activeOrganization },
          })
        ).count,
    );
  }
  clear(digest: string, expected: string) {
    return persist(async () => {
      await this.db.session.updateMany({
        where: { digest, activeOrganization: expected },
        data: { activeOrganization: null },
      });
    });
  }
}
