import {
  Customer,
  CustomerSession,
  CustomerToken,
} from "../../domain/customers/models";
import { MembersTransaction } from "../organizations/ports/members.repository";
export interface CustomersRepository {
  find(id: string, organizationId?: string): Promise<Customer | null>;
  byEmail(index: string): Promise<Customer | null>;
  list(
    organizationId: string,
    emailIndex: string | undefined,
    skip: number,
    take: number,
  ): Promise<{ items: Customer[]; total: number }>;
  save(customer: Customer): Promise<void>;
  session(digest: string): Promise<CustomerSession | null>;
  sessions(customerId: string, now: Date): Promise<CustomerSession[]>;
  saveSession(session: CustomerSession): Promise<void>;
  revokeSessions(
    customerId: string,
    publicId?: string,
    exceptDigest?: string,
  ): Promise<void>;
  token(id: string): Promise<CustomerToken | null>;
  latestToken(customerId: string, kind: string): Promise<CustomerToken | null>;
  saveToken(token: CustomerToken): Promise<void>;
  revokeTokens(customerId: string, kind: string): Promise<void>;
  replaceRecovery(customerId: string, digests: string[]): Promise<void>;
  consumeRecovery(customerId: string, digest: string): Promise<number>;
}
export interface CustomerTransaction extends MembersTransaction {
  customers: CustomersRepository;
}
