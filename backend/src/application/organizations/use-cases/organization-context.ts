import { z } from "zod";
import { Sessions } from "../../auth/use-cases/sessions";
import { UnitOfWork } from "../../auth/ports/repositories";
import { IdentityProtection } from "../../auth/ports/security";
import { SessionWithUser } from "../../../domain/auth/models";
import { MembersTransaction } from "../ports/members.repository";
export class OrganizationContext {
  constructor(
    private sessions: Sessions,
    private work: UnitOfWork<MembersTransaction>,
    private vault: IdentityProtection,
  ) {}
  private id(session: SessionWithUser) {
    try {
      return z
        .uuid()
        .parse(
          this.vault.decrypt(
            session.activeOrganization!,
            `organization-session:${session.digest}`,
          ),
        )
        .toLowerCase();
    } catch {
      return null;
    }
  }
  // Caller already holds the target organization's lock. Context switches and
  // protected administrative operations serialize on the same session lock.
  async check(
    tx: MembersTransaction,
    raw: string | undefined,
    target?: string,
  ) {
    const initial = await this.sessions.authorized(raw, false, tx.sessions);
    if (!initial) return null;
    await tx.lock(`organization-context:${initial.digest}`);
    const session = await this.sessions.authorized(raw, false, tx.sessions);
    if (!session) return null;
    if (!session.activeOrganization) {
      const memberships = await tx.members.memberships(session.userId);
      return memberships.some((m) => m.role === "ORGANIZATION_ADMIN")
        ? { contextRequired: true as const }
        : { forbidden: true as const };
    }
    const id = this.id(session);
    const organization = id ? await tx.organizations.find(id) : null;
    const role = id ? await tx.members.role(id, session.userId) : null;
    if (
      !organization?.active ||
      organization.deletedAt ||
      role !== "ORGANIZATION_ADMIN"
    ) {
      await tx.contexts.clear(session.digest, session.activeOrganization);
      return { contextInvalid: true as const };
    }
    if (target && id !== target) return { contextRequired: true as const };
    return { organizationId: organization.id, name: organization.name };
  }
  async resolve(raw: string | undefined) {
    const initial = await this.sessions.authorized(raw, false);
    if (!initial) return null;
    const id = this.id(initial);
    return this.work.run(async (tx) => {
      if (id) await tx.lock(`organization:${id}`);
      return this.check(tx, raw, id ?? undefined);
    });
  }
  async select(raw: string | undefined, body: unknown) {
    if (!(await this.sessions.authorized(raw, false))) return null;
    const input = z
      .object({ organizationId: z.uuid().transform((id) => id.toLowerCase()) })
      .strict()
      .safeParse(body);
    if (!input.success) return { invalid: true as const };
    return this.work.run(async (tx) => {
      await tx.lock(`organization:${input.data.organizationId}`);
      const session = await this.sessions.authorized(raw, false, tx.sessions);
      if (!session) return null;
      await tx.lock(`organization-context:${session.digest}`);
      const current = await this.sessions.authorized(raw, false, tx.sessions);
      if (!current) return null;
      const org = await tx.organizations.find(input.data.organizationId);
      const role = await tx.members.role(
        input.data.organizationId,
        current.userId,
      );
      if (!org?.active || org.deletedAt || role !== "ORGANIZATION_ADMIN")
        return { forbidden: true as const };
      const saved = await tx.contexts.set(
        current.digest,
        this.vault.encrypt(org.id, `organization-session:${current.digest}`),
      );
      return saved ? { organizationId: org.id, name: org.name } : null;
    });
  }
}
