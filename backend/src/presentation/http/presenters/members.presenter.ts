import { Response } from "express";
import { Members } from "../../../application/organizations/use-cases/members";
import { sessionRequired } from "./auth.presenter";
type Result = Awaited<
  ReturnType<Members["list" | "add" | "update" | "restore"]>
>;
export class MembersPresenter {
  issue(res: Response, result: Result) {
    if (!result) return res.status(401).json(sessionRequired);
    if ("membershipConflict" in result)
      return res.status(409).json({
        message:
          "Esta conta já possui um vínculo ativo. A restauração não é permitida.",
      });
    if ("invitationRequired" in result)
      return res.status(410).json({
        message: "Use um convite para adicionar usuários à organização.",
      });
    if ("forbidden" in result)
      return res.status(403).json({
        message: "Você não tem permissão para esta operação nesta organização.",
      });
    if ("missing" in result)
      return res
        .status(404)
        .json({ message: "Organização ou vínculo não encontrado." });
    if ("invalid" in result && result.invalid)
      return res.status(400).json({
        message: {
          list: "Revise a busca, o cargo e a paginação.",
          new: "Revise o e-mail, o usuário (1–100 caracteres), a senha (15–1024 caracteres) e o papel organizacional.",
          existing:
            "Revise o e-mail da conta existente e o papel na organização.",
          role: "Selecione Membro ou Administrador da organização.",
          restore:
            "Não foi possível restaurar o vínculo. Atualize a página e tente novamente.",
          remove:
            "Não foi possível remover o vínculo. Atualize a página e tente novamente.",
          request:
            "Escolha cadastrar um usuário ou vincular uma conta existente.",
        }[result.invalid],
      });
    return res.status(200).json(result);
  }
}
