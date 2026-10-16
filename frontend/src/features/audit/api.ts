import { apiError, connectionError } from "@/lib/api-errors";
export interface AuditEvent {
  id: string;
  occurredAt: string;
  action: string;
  actionLabel: string;
  outcome: "success" | "failure";
  actor: string;
  organization: string | null;
  resource: string;
  resourceType: string;
}
export interface AuditDetail extends AuditEvent {
  metadata: { label: string; value: string }[];
}
export interface AuditPage {
  items: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  actions: { value: string; label: string }[];
}
export async function auditApi<T>(
  path: string,
  signal: AbortSignal,
  master = true,
): Promise<T> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_API_ORIGIN || "http://localhost:3001"}/v1/${master ? "admin/" : ""}audit${path}`,
    {
      credentials: "include",
      cache: "no-store",
      signal,
    },
  ).catch((error: unknown) => {
    if (signal.aborted) throw error;
    throw new Error(connectionError);
  });
  if (response.status === 401) {
    window.location.assign(
      new URL(master ? "/admin/login" : "/login", window.location.origin).href,
    );
    throw new Error("Sessão inválida ou sem acesso. Entre novamente.");
  }
  if (!response.ok) {
    if (response.status === 403)
      throw new Error(
        "Auditoria indisponível. Seu vínculo administrativo pode estar ausente ou ter sido revogado.",
      );
    if (response.status === 409)
      throw new Error(
        master
          ? "Organização indisponível. Selecione outra organização ou limpe os filtros."
          : "Auditoria indisponível para seu vínculo organizacional.",
      );
    if (response.status === 400)
      throw new Error("Revise o período, os filtros e a paginação.");
    if (response.status === 404) throw new Error("Evento não encontrado.");
    throw new Error(apiError(response.status, null, "admin/audit").message);
  }
  return response.json().catch(() => {
    throw new Error("Não foi possível carregar a auditoria.");
  });
}
