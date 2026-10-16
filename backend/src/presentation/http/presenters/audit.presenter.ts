import { Response } from "express";
import { QueryAudit } from "../../../application/audit/query-audit";
import { sessionRequired } from "./auth.presenter";
export class AuditPresenter {
  issue(
    res: Response,
    result: Awaited<ReturnType<QueryAudit["list" | "read"]>>,
  ) {
    if (!result) return res.status(401).json(sessionRequired);
    if ("invalid" in result)
      return res
        .status(400)
        .json({ message: "Revise o período, os filtros e a paginação." });
    if ("missing" in result)
      return res.status(404).json({ message: "Evento não encontrado." });
    return res.status(200).json(result);
  }
}
