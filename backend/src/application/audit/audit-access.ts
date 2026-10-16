import { Sessions } from "../auth/use-cases/sessions";
import { IdentityProtection } from "../auth/ports/security";
import { MembersRepository } from "../organizations/ports/members.repository";
import { OrganizationsRepository } from "../organizations/ports/organizations.repository";
import { AuditScopeRepository } from "./scope.repository";

export class AuditAccess {
  constructor(
    private sessions: Sessions,
    private members: Pick<MembersRepository, "memberships">,
    private organizations: Pick<OrganizationsRepository, "find">,
    private scopes: AuditScopeRepository,
    private vault: IdentityProtection,
  ) {}
  async resolve(raw: string | undefined) {
    const session = await this.sessions.authorized(raw, false);
    if (!session) return null;
    const memberships = await this.members.memberships(session.userId);
    const organizations = [];
    for (const membership of memberships) {
      if (membership.role !== "ORGANIZATION_ADMIN") continue;
      const organization = await this.organizations.find(
        membership.organizationId,
      );
      if (organization?.active && !organization.deletedAt)
        organizations.push(organization);
    }
    if (organizations.length !== 1) return { forbidden: true as const };
    const organization = organizations[0];
    const purpose = `audit-session:${session.digest}`;
    const encrypted = await this.scopes.bind(
      session.digest,
      this.vault.encrypt(organization.id, purpose),
    );
    if (!encrypted) return null;
    try {
      if (this.vault.decrypt(encrypted, purpose) !== organization.id)
        return { forbidden: true as const };
    } catch {
      return { forbidden: true as const };
    }
    return { organizationId: organization.id, name: organization.name };
  }
}
