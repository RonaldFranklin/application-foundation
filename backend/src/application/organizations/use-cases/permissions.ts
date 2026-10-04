import { z } from "zod";
import { OrganizationAccess } from "./organization-access";
import { permissionCatalog, permissionKeys } from "../permissions";
const schema = z
  .object({
    role: z.literal("MEMBER"),
    permissions: z
      .array(z.enum(permissionKeys))
      .max(permissionKeys.length)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export class Permissions {
  constructor(private access: OrganizationAccess) {}
  execute(
    raw: string | undefined,
    id: unknown,
    body?: unknown,
    masterOnly = true,
  ) {
    return this.access.run(id, async (tx) => {
      const access = await this.access.check(
        tx,
        raw,
        id,
        "permissions.manage",
        masterOnly,
      );
      if (!access || !("organization" in access)) return access;
      if (body !== undefined) {
        const input = schema.safeParse(body);
        if (!input.success) return { invalid: true as const };
        await tx.permissions.replace(
          access.organization.id,
          input.data.permissions,
        );
      }
      return {
        catalog: permissionCatalog,
        roles: {
          ORGANIZATION_ADMIN: { protected: true, permissions: permissionKeys },
          MEMBER: {
            protected: false,
            permissions: await tx.permissions.list(access.organization.id),
          },
        },
      };
    });
  }
}
