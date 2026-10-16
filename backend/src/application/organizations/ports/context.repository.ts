export interface OrganizationContextRepository {
  set(sessionDigest: string, encryptedOrganization: string): Promise<number>;
  clear(sessionDigest: string, expected: string): Promise<void>;
}
