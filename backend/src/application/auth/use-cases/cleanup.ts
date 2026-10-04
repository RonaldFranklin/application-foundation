import { AuthRepositories } from "../ports/repositories";
export class Cleanup {
  constructor(private repos: AuthRepositories) {}
  async execute() {
    const now = new Date();
    await Promise.all([
      this.repos.sessions.deleteExpiredDevices(now),
      this.repos.sessions.deleteExpiredSessions(now),
      this.repos.rates.deleteInactive(new Date(+now - 86400000), now),
    ]);
  }
}
