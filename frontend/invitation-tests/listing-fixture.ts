export type FixtureInvitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdBy?: string;
  createdAt?: string;
  deliveredAt?: string | null;
  status?: "pending" | "expired" | "accepted" | "revoked";
};
export function invitationPage(items: FixtureInvitation[], url: string) {
  const query = new URL(url).searchParams;
  const search = (query.get("search") || "").trim().toLowerCase();
  const status = query.get("status") || "all";
  const page = Number(query.get("page") || 1),
    pageSize = Number(query.get("pageSize") || 10);
  const matching = items
    .map((i) => ({
      createdBy: "criador-teste",
      createdAt: "2026-10-01T12:00:00Z",
      deliveredAt: null,
      status: "pending" as const,
      ...i,
    }))
    .filter((i) => i.email.toLowerCase().includes(search));
  const counts = {
    all: matching.length,
    pending: 0,
    expired: 0,
    accepted: 0,
    revoked: 0,
  };
  matching.forEach((i) => counts[i.status]++);
  const filtered = matching.filter(
    (i) => status === "all" || i.status === status,
  );
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    counts,
    page,
    pageSize,
  };
}
