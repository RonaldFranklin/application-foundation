import { Sessions } from "../../auth/use-cases/sessions";
import { UnitOfWork } from "../../auth/ports/repositories";
import { MembersTransaction } from "../ports/members.repository";

// Resolve from current membership on every request; session/client hints are never authority.
export class OrganizationScope {
  constructor(
    private sessions: Sessions,
    private work: UnitOfWork<MembersTransaction>,
  ) {}
  async resolve(raw: string | undefined) {
    return this.work.run(async (tx) => {
      const session = await this.sessions.authorized(raw, false, tx.sessions);
      if (!session) return null;
      const memberships = await tx.members.memberships(session.userId);
      if (
        memberships.length !== 1 ||
        memberships[0].role !== "ORGANIZATION_ADMIN"
      )
        return { forbidden: true as const };
      const id = memberships[0].organizationId;
      await tx.lock(`organization:${id}`);
      const current = await tx.members.memberships(session.userId);
      if (
        current.length !== 1 ||
        current[0].organizationId !== id ||
        current[0].role !== "ORGANIZATION_ADMIN"
      )
        return { forbidden: true as const };
      const organization = await tx.organizations.find(id);
      if (!organization?.active || organization.deletedAt)
        return { forbidden: true as const };
      return { organizationId: id, name: organization.name };
    });
  }
}
