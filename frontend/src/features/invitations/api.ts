const messages: Record<string, string> = {
  INPUT_INVALID: "Revise os dados do convite.",
  SESSION_REQUIRED:
    "Entre na conta correspondente ao convite e tente novamente.",
  FORBIDDEN:
    "Você não tem permissão para gerenciar convites nesta organização.",
  INVITATION_INVALID:
    "Convite inválido ou substituído. Solicite um novo convite.",
  INVITATION_EXPIRED: "Este convite expirou. Solicite um novo convite.",
  INVITATION_REVOKED: "Este convite foi cancelado. Solicite um novo convite.",
  INVITATION_USED: "Este convite já foi aceito. Entre pelo login normal.",
  INVITATION_PENDING:
    "Já existe um convite pendente para este endereço nesta organização.",
  MEMBERSHIP_CONFLICT:
    "Você já possui um vínculo ativo. Não é possível ingressar em outra organização.",
  ACCEPT_UNAVAILABLE:
    "Não foi possível aceitar. Confira seus dados ou entre na conta correspondente. Um vínculo removido deve ser restaurado pelo Master.",
  UNAVAILABLE:
    "Serviço temporariamente indisponível. Tente novamente mais tarde.",
  RATE_LIMIT: "Aguarde antes de enviar outro convite.",
};
export async function invitationApi<T>(
  path: string,
  body?: object,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001"}/v1${path}`,
    {
      method: body ? "POST" : "GET",
      credentials: "include",
      cache: "no-store",
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  ).catch(() => {
    throw new Error("Não foi possível conectar. Tente novamente.");
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      messages[data?.code] ||
        "Não foi possível concluir a operação. Tente novamente.",
    );
  return data;
}
