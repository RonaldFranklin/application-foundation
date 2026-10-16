import { Response } from "express";
import { Permissions } from "../../../application/organizations/use-cases/permissions";
import { sessionRequired } from "./auth.presenter";
export class PermissionsPresenter {
  issue(res: Response, result: Awaited<ReturnType<Permissions["execute"]>>) {
    if (!result) return res.status(401).json(sessionRequired);
    if ("contextRequired" in result)
      return res
        .status(409)
        .json({
          code: "ORGANIZATION_CONTEXT_REQUIRED",
          message: "Selecione a organização antes de continuar.",
        });
    if ("contextInvalid" in result)
      return res
        .status(403)
        .json({
          code: "ORGANIZATION_CONTEXT_INVALID",
          message:
            "O contexto perdeu validade. Selecione novamente uma organização autorizada.",
        });
    if ("forbidden" in result)
      return res.status(403).json({
        message: "Você não tem permissão para esta operação nesta organização.",
      });
    if ("missing" in result)
      return res.status(404).json({ message: "Organização não encontrada." });
    if ("invalid" in result)
      return res.status(400).json({
        message:
          "Selecione somente permissões conhecidas do cargo Membro. O acesso do administrador é protegido.",
      });
    return res.status(200).json(result);
  }
}
