import { AuthTransaction } from "../auth/ports/repositories";
import { UserRecord } from "../../domain/auth/models";
export interface PlatformInvitation {
  id: string;
  email: string;
  emailFingerprint: string;
  digest: string;
  permissions: string[];
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  deliveredAt: Date | null;
  attempts: number;
}
export interface PlatformAdminsRepository {
  list(): Promise<
    {
      user: UserRecord;
      active: boolean;
      permissions: string[];
      createdAt: Date;
    }[]
  >;
  save(userId: string, active: boolean, permissions: string[]): Promise<void>;
  invitation(id: string): Promise<PlatformInvitation | null>;
  forEmail(fingerprint: string): Promise<PlatformInvitation | null>;
  invitations(): Promise<PlatformInvitation[]>;
  saveInvitation(i: PlatformInvitation): Promise<void>;
}
export interface PlatformTransaction extends AuthTransaction {
  platformAdmins: PlatformAdminsRepository;
}
export const platformContext = (i: PlatformInvitation) =>
  JSON.stringify(["platform-admin", i.id, i.emailFingerprint]);
export const platformEmailPurpose = (i: Pick<PlatformInvitation, "id">) =>
  `platform-admin-email:${i.id}`;
