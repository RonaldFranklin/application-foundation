export interface AuditScopeRepository {
  // Compare-and-set: bind once, then return the persisted encrypted context.
  bind(
    sessionDigest: string,
    encryptedOrganization: string,
  ): Promise<string | null>;
}
