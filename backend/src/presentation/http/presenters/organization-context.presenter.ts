import { Response } from "express";
import { OrganizationContext } from "../../../application/organizations/use-cases/organization-context";
import { sessionRequired } from "./auth.presenter";
export class OrganizationContextPresenter {
  issue(
    res: Response,
    result: Awaited<ReturnType<OrganizationContext["select" | "resolve"]>>,
  ) {
    if (!result) return res.status(401).json(sessionRequired);
    if ("invalid" in result)
      return res.status(400).json({ message: "Seleção inválida." });
    if ("contextRequired" in result)
      return res.status(409).json({
        code: "ORGANIZATION_CONTEXT_REQUIRED",
        message: "Selecione uma organização para continuar.",
      });
    if ("contextInvalid" in result)
      return res.status(403).json({
        code: "ORGANIZATION_CONTEXT_INVALID",
        message:
          "O contexto perdeu validade. Selecione novamente uma organização autorizada.",
      });
    if ("forbidden" in result)
      return res.status(403).json({
        message: "Organização indisponível ou sem autorização administrativa.",
      });
    return res.status(200).json(result);
  }
}
