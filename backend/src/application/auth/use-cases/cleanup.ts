import { ExpireInvitations } from "../../organization-invitations/expire-invitations";
import { AuthRepositories } from "../ports/repositories";
export class Cleanup {
  constructor(
    private repos: AuthRepositories,
    private invitations?: ExpireInvitations,
  ) {}
  async execute() {
    const now = new Date();
    await Promise.all([
      this.invitations?.execute(now),
      this.repos.sessions.deleteExpiredDevices(now),
      this.repos.sessions.deleteExpiredSessions(now),
      this.repos.rates.deleteInactive(new Date(+now - 86400000), now),
    ]);
  }
}
