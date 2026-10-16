import { Response } from "express";
import { QueryAudit } from "../../../application/audit/query-audit";
import { sessionRequired } from "./auth.presenter";
export class AuditPresenter {
  issue(
    res: Response,
    result: Awaited<
      ReturnType<
        QueryAudit[
          | "list"
          | "read"
          | "organizationOptions"
          | "organizationAccess"
          | "listOrganization"
          | "readOrganization"]
      >
    >,
  ) {
    if (!result) return res.status(401).json(sessionRequired);
    if ("forbidden" in result)
      return res.status(403).json({
        message: "Auditoria indisponível para este contexto de organização.",
      });
    if ("organizationUnavailable" in result)
      return res.status(409).json({
        code: "AUDIT_ORGANIZATION_UNAVAILABLE",
        message:
          "Organização indisponível. Selecione outra organização ou limpe os filtros.",
      });
    if ("invalid" in result)
      return res
        .status(400)
        .json({ message: "Revise o período, os filtros e a paginação." });
    if ("missing" in result)
      return res.status(404).json({ message: "Evento não encontrado." });
    return res.status(200).json(result);
  }
}
