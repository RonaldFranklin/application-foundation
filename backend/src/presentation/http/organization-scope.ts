import { Request } from "express";
// Match Express case-insensitive routing; URL casing must not downgrade the namespace.
// The use case validates the actor for this transport context.
export const masterOrganizationRoute = (req: Request) =>
  req.path.toLowerCase().startsWith("/v1/admin/");
