import { Request } from "express";
// Route namespace is transport context; the use case validates the actor for that context.
export const masterOrganizationRoute = (req: Request) =>
  req.path.startsWith("/v1/admin/");
