import { OrganizationAccess } from "./organization-access";
import { z } from "zod";
import { Sessions } from "../../auth/use-cases/sessions";
import { OrganizationsRepository } from "../ports/organizations.repository";
const name = z.string().trim().min(1).max(200);
const integer = (fallback: string, max: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .default(fallback)
    .transform(Number)
    .pipe(z.number().int().max(max));
const querySchema = z
  .object({
    search: z.string().trim().max(200).default(""),
    status: z.enum(["active", "inactive"]).optional(),
    page: integer("1", 1000000),
    pageSize: integer("10", 100),
  })
  .strict();
const createSchema = z.object({ name }).strict();
const updateSchema = z
  .object({ name: name.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.active !== undefined);
export class Organizations {
  constructor(
    private sessions: Sessions,
    private records: OrganizationsRepository,
    private access: OrganizationAccess,
  ) {}
  async list(raw: string | undefined, query: unknown) {
    if (!(await this.sessions.authorized(raw, true))) return null;
    const input = querySchema.safeParse(query);
    if (!input.success) return { invalid: true as const };
    const { status, ...rest } = input.data;
    return this.records.list({
      ...rest,
      active: status === undefined ? undefined : status === "active",
    });
  }
  async create(raw: string | undefined, body: unknown) {
    if (!(await this.sessions.authorized(raw, true))) return null;
    const input = createSchema.safeParse(body);
    if (!input.success) return { invalid: true as const };
    return this.records.create(input.data.name);
  }
  async read(raw: string | undefined, id: unknown, masterOnly = true) {
    return this.access.run(id, async (tx) => {
      const access = await this.access.check(
        tx,
        raw,
        id,
        "organization.read",
        masterOnly,
      );
      return access && "organization" in access ? access.organization : access;
    });
  }
  async update(
    raw: string | undefined,
    id: unknown,
    body: unknown,
    masterOnly = true,
  ) {
    return this.access.run(id, async (tx) => {
      const access = await this.access.check(
        tx,
        raw,
        id,
        "organization.update",
        masterOnly,
      );
      if (!access || !("organization" in access)) return access;
      const input = updateSchema.safeParse(body);
      if (!input.success) return { invalid: true as const };
      return (
        (await tx.organizations.update(access.organization.id, input.data)) ?? {
          missing: true as const,
        }
      );
    });
  }
}
