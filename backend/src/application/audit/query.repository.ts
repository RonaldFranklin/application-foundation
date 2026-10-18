export interface StoredAuditEvent {
  id: string;
  occurredAt: Date;
  action: string;
  outcome: string;
  resourceType: string;
  details: string;
}
export interface AuditQuery {
  includeCustomers?: boolean;
  organizationIndex?: string;
  from?: Date;
  to?: Date;
  action?: string;
  outcome?: "success" | "failure";
  page: number;
  pageSize: number;
}
export interface AuditQueryRepository {
  list(
    query: AuditQuery,
  ): Promise<{ items: StoredAuditEvent[]; total: number }>;
  find(
    id: string,
    organizationIndex?: string,
    includeCustomers?: boolean,
  ): Promise<StoredAuditEvent | null>;
}
