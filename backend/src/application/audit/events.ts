import { platformPermissionKeys } from "../platform-admin/permissions";
import { z } from "zod";
import { permissionKeys } from "../organizations/permissions";
const empty = z.object({}).strict();
const role = z.enum(["MEMBER", "ORGANIZATION_ADMIN"]);
const catalog = {
  "customer.invited": ["customer", empty],
  "customer.reset_requested": ["customer", empty],
  "customer.delivery_failed": ["customer", empty],
  "customer.invitation_cancelled": ["customer", empty],
  "customer.reactivated": ["customer", empty],
  "customer.suspended": ["customer", empty],
  "customer.activated": ["customer", empty],
  "customer.password_reset": ["customer", empty],
  "customer.login": ["customer", empty],
  "customer.password_accepted": ["customer", empty],
  "customer.updated": ["customer", empty],
  "customer.logout": ["customer", empty],
  "customer.sessions_revoked": ["customer", empty],
  "customer.recovery_used": ["customer", empty],
  "customer.mfa_failed": ["customer", empty],
  "customer.mfa_setup": ["customer", empty],
  "customer.mfa_enabled": ["customer", empty],
  "customer.mfa_disabled": ["customer", empty],
  "customer.email_delivered": ["customer", empty],
  "customer.login_failed": ["customer", empty],

  "platform_role.created": ["platform_role", empty],
  "platform_role.updated": ["platform_role", empty],
  "platform_role.deleted": ["platform_role", empty],
  "platform_admin.role_assigned": [
    "account",
    z.object({ roleId: z.uuid().nullable() }).strict(),
  ],
  "platform_invitation.role_assigned": [
    "invitation",
    z.object({ roleId: z.uuid().nullable() }).strict(),
  ],
  "platform_invitation.created": ["invitation", empty],
  "platform_invitation.resent": ["invitation", empty],
  "platform_invitation.revoked": ["invitation", empty],
  "platform_invitation.accepted": ["invitation", empty],
  "platform_invitation.delivered": ["invitation", empty],
  "platform_admin.activated": ["account", empty],
  "platform_admin.deactivated": ["account", empty],
  "platform_admin.restored": ["account", empty],
  "platform_admin.permissions_changed": [
    "account",
    z
      .object({
        granted: z.array(z.enum(platformPermissionKeys)).max(6),
        removed: z.array(z.enum(platformPermissionKeys)).max(6),
      })
      .strict(),
  ],

  "organization.created": ["organization", empty],
  "organization.updated": ["organization", empty],
  "organization.deactivated": ["organization", empty],
  "organization.reactivated": ["organization", empty],
  "organization.deleted": ["organization", empty],
  "organization.restored": ["organization", empty],
  "invitation.created": ["invitation", z.object({ role }).strict()],
  "invitation.resent": ["invitation", z.object({ role }).strict()],
  "invitation.delivered": ["invitation", empty],
  "invitation.delivery_failed": ["invitation", empty],
  "invitation.queue_failed": ["invitation", empty],
  "invitation.revoked": ["invitation", empty],
  "invitation.accepted": ["invitation", empty],
  "invitation.expired": ["invitation", empty],
  "member.added": ["member", z.object({ role }).strict()],
  "member.removed": ["member", empty],
  "member.restored": ["member", empty],
  "member.role_changed": [
    "member",
    z.object({ previousRole: role, role }).strict(),
  ],
  "permissions.changed": [
    "permissions",
    z
      .object({
        permissions: z.array(z.enum(permissionKeys)).max(permissionKeys.length),
      })
      .strict(),
  ],
  "account.updated": [
    "account",
    z
      .object({ fields: z.array(z.enum(["username", "email"])).max(2) })
      .strict(),
  ],
  "account.password_changed": ["account", empty],
  "account.initial_password_changed": ["account", empty],
  "account.email_verified": ["account", empty],
  "auth.password_accepted": ["account", empty],
  "auth.login": ["account", empty],
  "auth.login_failed": ["account", empty],
  "auth.logout": ["account", z.object({ forgetDevice: z.boolean() }).strict()],
  "account.sessions_revoked": [
    "account",
    z
      .object({
        scope: z.enum(["current", "other", "others"]),
        count: z.number().int().nonnegative(),
      })
      .strict(),
  ],
  "account.password_reset": ["account", empty],
  "account.mfa_reset": ["account", empty],
  "auth.mfa_setup": ["account", empty],
  "auth.mfa_enrolled": ["account", empty],
  "auth.mfa_verified": ["account", empty],
  "auth.recovery_used": ["account", empty],
  "auth.mfa_failed": ["account", empty],
  "auth.reauthentication_failed": ["account", empty],
  "administration.denied": [
    "account",
    z
      .object({
        permission: z.enum([
          ...permissionKeys,
          "master",
          "organization.access",
        ]),
      })
      .strict(),
  ],
} as const;
export type AuditAction = keyof typeof catalog;
export interface AuditEvent {
  action: AuditAction;
  actorId?: string | null;
  organizationId?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}
export interface AuditRepository {
  append(event: AuditEvent): Promise<void>;
  // Infrastructure isolates a failed write with a savepoint; rejection must remain a rejection.
  bestEffort(event: AuditEvent): Promise<void>;
}
export function validateAudit(event: AuditEvent) {
  const parsed = z
    .object({
      action: z.enum(Object.keys(catalog) as [AuditAction, ...AuditAction[]]),
      actorId: z.uuid().nullable().optional(),
      organizationId: z.uuid().nullable().optional(),
      resourceId: z.uuid().nullable().optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
      occurredAt: z.date().optional(),
    })
    .strict()
    .safeParse(event);
  if (!parsed.success) throw new Error("AUDIT_INPUT_INVALID");
  const [resourceType, schema] = catalog[parsed.data.action];
  const metadata = schema.safeParse(parsed.data.metadata ?? {});
  if (!metadata.success) throw new Error("AUDIT_INPUT_INVALID");
  const outcome = /(?:_failed|\.denied)$/.test(event.action)
    ? "failure"
    : "success";
  return { ...parsed.data, metadata: metadata.data, resourceType, outcome };
}

// Called explicitly by use cases; adapters also enforce this boundary defensively.
export async function recordAudit(
  tx: { audit: AuditRepository },
  event: AuditEvent,
) {
  validateAudit(event);
  await tx.audit.append(event);
}
export async function attemptAudit(
  tx: { audit: AuditRepository },
  event: AuditEvent,
) {
  try {
    validateAudit(event);
    await tx.audit.bestEffort(event);
  } catch {
    /* Audit failure cannot change a rejected authentication/authorization result. */
  }
}
