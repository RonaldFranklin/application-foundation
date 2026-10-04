const API = process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001";
const messages: Record<string, string> = {
  INPUT_INVALID: "Informe um código de seis dígitos.",
  SESSION_REQUIRED: "Entre novamente para verificar seu e-mail.",
  ALREADY_VERIFIED: "Seu e-mail já está verificado. Atualize a página.",
  COOLDOWN: "Aguarde antes de solicitar outro código.",
  SEND_LIMIT: "Limite de envios atingido. Tente novamente mais tarde.",
  CODE_INVALID: "Código incorreto. Confira os seis dígitos.",
  CODE_EXPIRED: "Código expirado. Solicite um novo código.",
  ATTEMPT_LIMIT: "Limite de tentativas atingido. Solicite um novo código.",
  CODE_USED: "Código já utilizado ou invalidado. Solicite um novo código.",
};
export class VerificationRequestError extends Error {
  constructor(
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export async function verificationRequest(
  action: "request" | "confirm",
  code?: string,
): Promise<{ retryAfter?: number; emailVerifiedAt?: string }> {
  let response: Response;
  try {
    response = await fetch(`${API}/v1/auth/email-verification/${action}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "confirm" ? { code } : {}),
    });
  } catch {
    throw new VerificationRequestError(
      "Não foi possível conectar. Tente novamente.",
    );
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data)
    throw new VerificationRequestError(
      messages[data?.code] ||
        "Verificação temporariamente indisponível. Tente novamente.",
      Number.isFinite(data?.retryAfter) ? Math.max(0, data.retryAfter) : 0,
    );
  return data;
}
