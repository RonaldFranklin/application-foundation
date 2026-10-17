import { PlatformRoles } from "../../../application/platform-admin/platform-roles";
import { Response } from "express";
import {
  PlatformAdmins,
  platformMessages,
} from "../../../application/platform-admin/platform-admins";
type Result = Awaited<
  ReturnType<PlatformAdmins["list" | "change" | "issue" | "revoke" | "accept"]>
>;
export function presentPlatformAdmin(
  res: Response,
  result:
    | Result
    | Awaited<ReturnType<PlatformRoles["list" | "save" | "remove" | "assign"]>>,
) {
  if ("error" in result) {
    const code = result.error;
    const status =
      code === "FORBIDDEN"
        ? 403
        : ["CONFLICT", "ROLE_CONFLICT", "ROLE_IN_USE"].includes(code)
          ? 409
          : code === "RATE_LIMIT"
            ? 429
            : code === "UNAVAILABLE"
              ? 503
              : 400;
    if (status === 429) res.setHeader("Retry-After", "60");
    return res.status(status).json({ code, message: platformMessages[code] });
  }
  return res.status(200).json(result);
}
