import { Response } from "express";
import { Members } from "../../../application/organizations/use-cases/members";
import { sessionRequired } from "./auth.presenter";
type Result = Awaited<ReturnType<Members["list" | "add" | "update"]>>;
export class MembersPresenter {
  issue(res: Response, result: Result) {
    if (!result) return res.status(401).json(sessionRequired);
    if ("missing" in result)
      return res
        .status(404)
        .json({ message: "Organização ou vínculo não encontrado." });
    if ("invalid" in result && result.invalid)
      return res.status(400).json({
        message: {
          new: "Revise o e-mail, o usuário (1–100 caracteres), a senha (15–1024 caracteres) e o papel organizacional.",
          existing:
            "Revise o e-mail da conta existente e o papel na organização.",
          role: "Selecione Membro ou Administrador da organização.",
          remove:
            "Não foi possível remover o vínculo. Atualize a página e tente novamente.",
          request:
            "Escolha cadastrar um usuário ou vincular uma conta existente.",
        }[result.invalid],
      });
    if ("unavailable" in result)
      return res.status(404).json({
        message:
          "Conta comum não encontrada para este e-mail. Cadastre uma nova conta ou revise o endereço.",
      });
    if ("conflict" in result)
      return res.status(409).json({
        message:
          result.conflict === "membership"
            ? "O usuário já pertence a esta organização."
            : "Usuário ou e-mail já cadastrado. Para uma conta existente, use Vincular conta existente.",
      });
    if ("busy" in result)
      return res
        .status(503)
        .set("Retry-After", "1")
        .json({ message: "Serviço ocupado. Tente novamente." });
    return res.status(200).json(result);
  }
}
