import { UserRecord, Stage } from "../../domain/auth/models";
export function requiresMfaEnrollment(user: UserRecord) {
  return user.master || (!!user.platformAdmin && !user.mfaEnrollmentOptional);
}
export function nextAuthStage(user: UserRecord): Stage {
  if (user.mustChangePassword) return "password";
  if (user.totpVerified) return "mfa";
  return requiresMfaEnrollment(user) ? "setup" : "full";
}
