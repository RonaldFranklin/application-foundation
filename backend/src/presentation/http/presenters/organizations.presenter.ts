import { Response } from "express";
import { Organizations } from "../../../application/organizations/use-cases/organizations";
import { INVALID } from "../../../application/auth/results";
type Result = Awaited<
  ReturnType<Organizations["list" | "create" | "read" | "update"]>
>;
export class OrganizationsPresenter {
  issue(res: Response, result: Result) {
    if (!result) return res.status(401).json({ message: INVALID });
    if ("invalid" in result)
      return res
        .status(400)
        .json({
          message:
            "Revise os dados informados. Nome deve ter de 1 a 200 caracteres; paginação e estado devem ser válidos.",
        });
    if ("missing" in result)
      return res.status(404).json({ message: "Organização não encontrada." });
    return res.status(200).json(result);
  }
}
