import { Response } from "express";
import {
  PlatformAdmins,
  platformMessages,
} from "../../../application/platform-admin/platform-admins";
type Result = Awaited<
  ReturnType<PlatformAdmins["list" | "change" | "issue" | "revoke" | "accept"]>
>;
export function presentPlatformAdmin(res: Response, result: Result) {
  if ("error" in result) {
    const code = result.error;
    const status =
      code === "FORBIDDEN"
        ? 403
        : code === "CONFLICT"
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
