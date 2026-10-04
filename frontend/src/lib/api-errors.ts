// Only known public messages may reach the interface; never echo arbitrary server text.
const messages = {
  PASSWORD_REUSED: "A nova senha deve ser diferente da senha atual.",
  MFA_INVALID:
    "Código inválido ou já utilizado. Use um novo código do autenticador ou um código de recuperação válido, quando permitido.",
  REAUTHENTICATION_FAILED:
    "Não foi possível confirmar sua senha atual. Confira a senha e tente novamente.",
  ATTEMPTS_BLOCKED:
    "Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.",
  SESSION_REQUIRED:
    "Sessão inválida ou sem acesso a esta operação. Entre novamente.",
} as const;
export const connectionError =
  "Não foi possível conectar ao serviço. Verifique sua conexão e tente novamente.";
const fallback = "Não foi possível concluir a solicitação. Tente novamente.";
const fieldMessages = new Set([
  "Informe um usuário de 1 a 100 caracteres.",
  "Informe um e-mail válido de até 254 caracteres.",
  "Informe sua senha atual.",
  "Informe os seis dígitos do autenticador.",
  "Use uma nova senha de 15 a 1024 caracteres.",
  "A confirmação deve coincidir com a nova senha.",
  "Escolha uma senha diferente da atual.",
  "Solicitação inválida.",
]);
const publicMessages = new Set([
  ...fieldMessages,
  "Você não tem permissão para esta operação nesta organização.",
  "Mantenha ao menos um Administrador da organização. Defina outro administrador antes de continuar.",
  "Selecione somente permissões conhecidas do cargo Membro. O acesso do administrador é protegido.",
  "Revise a busca, o cargo e a paginação.",
  "Revise os campos informados.",
  "Use uma nova senha de 15 a 1024 caracteres e repita a mesma senha na confirmação.",
  "Não foi possível confirmar a alteração. Confira os dados e a autenticação ou tente novamente mais tarde.",
  "Organização ou vínculo não encontrado.",
  "Revise o e-mail, o usuário (1–100 caracteres), a senha (15–1024 caracteres) e o papel organizacional.",
  "Conta comum não encontrada para este e-mail. Cadastre uma nova conta ou revise o endereço.",
  "Revise o e-mail da conta existente e o papel na organização.",
  "Selecione Membro ou Administrador da organização.",
  "Não foi possível remover o vínculo. Atualize a página e tente novamente.",
  "Escolha cadastrar um usuário ou vincular uma conta existente.",
  "O usuário já pertence a esta organização.",
  "Usuário ou e-mail já cadastrado. Para uma conta existente, use Vincular conta existente.",
]);
export function apiError(status: number, payload: unknown, path: string) {
  const data =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};
  const fields: Record<string, string> = {};
  const isLogin = /(?:^|\/)auth\/login$/.test(path);
  let message = fallback;
  if (status >= 500)
    message =
      status === 503
        ? "Serviço temporariamente indisponível. Tente novamente em instantes."
        : fallback;
  else if (status === 429) message = messages.ATTEMPTS_BLOCKED;
  else if (status === 403)
    message =
      data.message ===
      "Você não tem permissão para esta operação nesta organização."
        ? data.message
        : "Esta solicitação não foi autorizada. Atualize a página e tente novamente.";
  else if (status === 413)
    message =
      "Os dados enviados excedem o tamanho permitido. Revise os campos.";
  else if (isLogin) message = "E-mail ou senha inválidos.";
  else if (
    typeof data.code === "string" &&
    Object.hasOwn(messages, data.code)
  ) {
    message = messages[data.code as keyof typeof messages];
    if (data.code === "REAUTHENTICATION_FAILED")
      fields.currentPassword = message;
    if (data.code === "MFA_INVALID") fields.code = message;
  } else if (status === 401)
    message =
      path === "auth/profile" || path === "auth/password"
        ? data.message ===
          "Não foi possível confirmar a alteração. Confira os dados e a autenticação ou tente novamente mais tarde."
          ? data.message
          : messages.SESSION_REQUIRED
        : messages.SESSION_REQUIRED;
  else if (typeof data.message === "string" && publicMessages.has(data.message))
    message = data.message;
  else if (status === 400)
    message =
      path.includes("organizations") && !path.includes("/members")
        ? "Revise os dados informados. Use um nome de 1 a 200 caracteres."
        : "Revise os campos informados.";
  else if (status === 404)
    message = path.includes("/members")
      ? "Organização ou vínculo não encontrado."
      : path.includes("organizations")
        ? "Organização não encontrada."
        : "Não foi possível acessar esta operação. Atualize a página e tente novamente.";
  else if (status === 409)
    message =
      "Os dados foram alterados ou já estão em uso. Atualize a página e revise a solicitação.";
  if (
    status === 400 &&
    !isLogin &&
    data.fields &&
    typeof data.fields === "object"
  ) {
    for (const [key, value] of Object.entries(data.fields)) {
      if (
        [
          "username",
          "email",
          "currentPassword",
          "code",
          "newPassword",
          "confirmPassword",
          "form",
        ].includes(key) &&
        typeof value === "string" &&
        fieldMessages.has(value)
      )
        fields[key] = value;
    }
  }
  return {
    message,
    fields,
    challengeRequired: isLogin && data.challengeRequired === true,
  };
}
