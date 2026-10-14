import { Response } from "express";
import {
  Invitations,
  invitationMessages,
} from "../../../application/organization-invitations/invitations";
const statuses: Record<string, number> = {
  SESSION_REQUIRED: 401,
  FORBIDDEN: 403,
  INVITATION_PENDING: 409,
  RATE_LIMIT: 429,
  UNAVAILABLE: 503,
};
type Result = Awaited<
  ReturnType<Invitations["list" | "issue" | "revoke" | "preview" | "accept"]>
>;
export function presentInvitation(res: Response, result: Result) {
  if ("error" in result) {
    const code = result.error as keyof typeof invitationMessages;
    if ("retryAfter" in result)
      res.setHeader("Retry-After", String(result.retryAfter));
    return res
      .status(statuses[code] ?? 400)
      .json({ code, message: invitationMessages[code] });
  }
  return res.status(200).json(result);
}
