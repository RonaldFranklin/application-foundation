import { z } from "zod";
import { Sessions } from "../auth/use-cases/sessions";
import { IdentityRepository } from "../auth/ports/repositories";
import { IdentityProtection } from "../auth/ports/security";
import { OrganizationsRepository } from "../organizations/ports/organizations.repository";
import {
  permissionCatalog,
  OrganizationPermission,
} from "../organizations/permissions";
import { AuditAction, validateAudit } from "./events";
import { auditLabels } from "./labels";
import { AuditQueryRepository, StoredAuditEvent } from "./query.repository";
const integer = (fallback: string, max: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .default(fallback)
    .transform(Number)
    .pipe(z.number().int().max(max));
const instant = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const filters = z
  .object({
    organizationId: z
      .uuid()
      .transform((id) => id.toLowerCase())
      .optional(),
    from: instant.optional(),
    to: instant.optional(),
    action: z
      .enum(Object.keys(auditLabels) as [AuditAction, ...AuditAction[]])
      .optional(),
    outcome: z.enum(["success", "failure"]).optional(),
    page: integer("1", 1000000),
    pageSize: integer("10", 100),
  })
  .strict()
  .refine((q) => !q.from || !q.to || +q.from <= +q.to);
const detailsSchema = z
  .object({
    actorId: z.uuid().nullable(),
    organizationId: z.uuid().nullable(),
    resourceId: z.uuid().nullable(),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
const resourceLabels: Record<string, string> = {
  organization: "Organização",
  member: "Membro",
  permissions: "Permissões",
  account: "Conta",
  invitation: "Convite",
};
export interface AuditSummary {
  id: string;
  occurredAt: string;
  action: string;
  actionLabel: string;
  outcome: string;
  actor: string;
  organization: string | null;
  resource: string;
  resourceType: string;
}
export interface AuditDetail extends AuditSummary {
  metadata: { label: string; value: string }[];
}
export class QueryAudit {
  constructor(
    private sessions: Sessions,
    private records: AuditQueryRepository,
    private identities: IdentityRepository,
    private organizations: Pick<OrganizationsRepository, "find" | "list">,
    private vault: IdentityProtection,
  ) {}
  async list(raw: string | undefined, query: unknown) {
    if (!(await this.sessions.authorized(raw, true))) return null;
    const input = filters.safeParse(query);
    if (!input.success) return { invalid: true as const };
    const { organizationId, ...queryFilters } = input.data;
    if (organizationId) {
      const organization = await this.organizations.find(organizationId);
      if (!organization?.active || organization.deletedAt)
        return { organizationUnavailable: true as const };
    }
    const result = await this.records.list({
      ...queryFilters,
      organizationIndex: organizationId
        ? this.vault.index(organizationId, "audit-organization")
        : undefined,
    });
    const names = this.references();
    const items: AuditSummary[] = [];
    for (const row of result.items) {
      const { metadata: _metadata, ...summary } = await this.present(
        row,
        names,
      );
      void _metadata;
      items.push(summary);
    }
    return {
      items,
      total: result.total,
      page: input.data.page,
      pageSize: input.data.pageSize,
      actions: Object.entries(auditLabels).map(([value, label]) => ({
        value,
        label,
      })),
    };
  }
  async organizationOptions(raw: string | undefined, query: unknown) {
    if (!(await this.sessions.authorized(raw, true))) return null;
    const input = z
      .object({ page: integer("1", 1000000), pageSize: integer("100", 100) })
      .strict()
      .safeParse(query);
    if (!input.success) return { invalid: true as const };
    const result = await this.organizations.list({
      ...input.data,
      search: "",
      active: true,
      deleted: false,
    });
    return {
      ...input.data,
      total: result.total,
      items: result.items.map(({ id, name }) => ({ id, name })),
    };
  }
  async read(raw: string | undefined, id: unknown, query: unknown = {}) {
    if (!(await this.sessions.authorized(raw, true))) return null;
    if (!z.object({}).strict().safeParse(query).success)
      return { invalid: true as const };
    if (!z.uuid().safeParse(id).success) return { missing: true as const };
    const row = await this.records.find((id as string).toLowerCase());
    return row
      ? this.present(row, this.references())
      : { missing: true as const };
  }
  private references() {
    // Request-scoped cache: bounded by the page, no persistent identity cache.
    const users = new Map<string, Promise<string>>(),
      organizations = new Map<string, Promise<string>>();
    return {
      user: (id: string) => {
        if (!users.has(id))
          users.set(
            id,
            this.identities
              .findById(id)
              .then((user) =>
                user
                  ? this.vault.decrypt(user.username, "username")
                  : "Conta não disponível",
              ),
          );
        return users.get(id)!;
      },
      organization: (id: string) => {
        if (!organizations.has(id))
          organizations.set(
            id,
            this.organizations
              .find(id)
              .then((org) => org?.name ?? "Organização não disponível"),
          );
        return organizations.get(id)!;
      },
    };
  }
  private async present(
    row: StoredAuditEvent,
    names: ReturnType<QueryAudit["references"]>,
  ): Promise<AuditDetail> {
    try {
      const parsed = detailsSchema.parse(
        JSON.parse(
          this.vault.decrypt(
            row.details,
            JSON.stringify([
              "audit:v1",
              row.id,
              row.occurredAt.toISOString(),
              row.action,
              row.outcome,
              row.resourceType,
            ]),
          ),
        ),
      );
      const event = validateAudit({
        action: row.action as AuditAction,
        ...parsed,
      });
      if (
        event.outcome !== row.outcome ||
        event.resourceType !== row.resourceType
      )
        throw new Error();
      const actor = parsed.actorId
        ? await names.user(parsed.actorId)
        : "Sistema ou ator não identificado";
      const organization = parsed.organizationId
        ? await names.organization(parsed.organizationId)
        : null;
      const type = resourceLabels[event.resourceType];
      let resource = type;
      if (parsed.resourceId) {
        if (event.resourceType === "account" || event.resourceType === "member")
          resource = `${type}: ${await names.user(parsed.resourceId)}`;
        if (
          event.resourceType === "organization" ||
          event.resourceType === "permissions"
        )
          resource = `${type}: ${await names.organization(parsed.resourceId)}`;
      }
      const metadata: AuditDetail["metadata"] = [];
      const m = event.metadata as Record<string, unknown>;
      const roleLabel = (role: unknown) =>
        role === "MEMBER" ? "Membro" : "Administrador da organização";
      if ("role" in m)
        metadata.push({ label: "Papel", value: roleLabel(m.role) });
      if ("previousRole" in m)
        metadata.push({
          label: "Papel anterior",
          value: roleLabel(m.previousRole),
        });
      if ("permissions" in m)
        metadata.push({
          label: "Permissões concedidas ao Membro",
          value:
            (m.permissions as OrganizationPermission[])
              .map((p) => permissionCatalog[p])
              .join(", ") || "Nenhuma",
        });
      if ("fields" in m && (m.fields as string[]).length)
        metadata.push({
          label: "Campos alterados",
          value: (m.fields as string[])
            .map((f) => (f === "username" ? "Usuário" : "E-mail"))
            .join(", "),
        });
      if ("forgetDevice" in m)
        metadata.push({
          label: "Esquecer dispositivo solicitado",
          value: m.forgetDevice ? "Sim" : "Não",
        });
      if ("permission" in m)
        metadata.push({
          label: "Acesso exigido",
          value:
            m.permission === "master"
              ? "Master da plataforma"
              : m.permission === "organization.access"
                ? "Acesso à organização"
                : permissionCatalog[m.permission as OrganizationPermission],
        });
      return {
        id: row.id,
        occurredAt: row.occurredAt.toISOString(),
        action: event.action,
        actionLabel: auditLabels[event.action],
        outcome: event.outcome,
        actor,
        organization,
        resource,
        resourceType: type,
        metadata,
      };
    } catch {
      // Neither ciphertext nor malformed/decrypted content may escape via errors.
      throw new Error("AUDIT_READ_UNAVAILABLE");
    }
  }
}
