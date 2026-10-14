import { MembersTransaction } from "../organizations/ports/members.repository";
import { VerificationTransaction } from "../email-verification/ports";
import { OrganizationRole } from "../../domain/organizations/models";
export interface Invitation {
  id: string;
  organizationId: string;
  email: string;
  emailFingerprint: string;
  role: OrganizationRole;
  digest: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  deliveredAt: Date | null;
}
export interface InvitationsRepository {
  locate(id: string): Promise<Invitation | null>;
  find(organizationId: string, id: string): Promise<Invitation | null>;
  forEmail(
    organizationId: string,
    fingerprint: string,
  ): Promise<Invitation | null>;
  pending(organizationId: string, now: Date): Promise<Invitation[]>;
  save(invitation: Invitation): Promise<void>;
}
export interface InvitationsTransaction
  extends MembersTransaction, VerificationTransaction {
  invitations: InvitationsRepository;
}
export interface InvitationJob {
  invitationId: string;
  encryptedToken: string;
}
export interface InvitationPublisher {
  publish(job: InvitationJob): Promise<void>;
}
export interface InvitationSecrets {
  generate(): { id: string; token: string };
  digest(token: string, context: string): string;
  matches(token: string, context: string, digest: string): boolean;
  encrypt(token: string, context: string): string;
  decrypt(envelope: string, context: string): string;
}
export const invitationContext = (
  i: Pick<Invitation, "id" | "organizationId" | "emailFingerprint" | "role">,
) => JSON.stringify([i.id, i.organizationId, i.emailFingerprint]);
export const invitationEmailPurpose = (
  i: Pick<Invitation, "id" | "organizationId">,
) => `organization-invitation-email:${i.organizationId}:${i.id}`;
