import { OrganizationAccess } from "../../../application/organizations/use-cases/organization-access";
import { Response } from "express";
import { Organizations } from "../../../application/organizations/use-cases/organizations";
import { sessionRequired } from "./auth.presenter";
type Result =
  | Awaited<ReturnType<OrganizationAccess["directory" | "describe"]>>
  | Awaited<ReturnType<Organizations["list" | "create" | "read" | "update"]>>;
export class OrganizationsPresenter {
  issue(res: Response, result: Result) {
    if (!result) return res.status(401).json(sessionRequired);
    if ("forbidden" in result)
      return res
        .status(403)
        .json({
          message:
            "Você não tem permissão para esta operação nesta organização.",
        });
    if ("invalid" in result)
      return res.status(400).json({
        message:
          "Revise os dados informados. Nome deve ter de 1 a 200 caracteres; paginação e estado devem ser válidos.",
      });
    if ("missing" in result)
      return res.status(404).json({ message: "Organização não encontrada." });
    return res.status(200).json(result);
  }
}
