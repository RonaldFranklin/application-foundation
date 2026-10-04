import {
  RateRepository,
  AuthTransaction,
  UnitOfWork,
} from "../ports/repositories";
import { AuthSettings } from "../auth-settings";
import { IdentityProtection } from "../ports/security";
export class Rates {
  constructor(
    private records: RateRepository,
    private work: UnitOfWork,
    private c: AuthSettings,
    private vault: IdentityProtection,
  ) {}
  async admitRequest(origin: string, login: boolean) {
    const ip = this.vault.index(origin || "unknown", "ip");
    if (!(await this.ip(`api:${ip}`, this.c.API_IP_LIMIT)))
      return "api-limit" as const;
    if (login && !(await this.ip(`login:${ip}`, this.c.LOGIN_IP_LIMIT)))
      return "login-limit" as const;
    return "allowed" as const;
  }
  async ip(key: string, limit: number) {
    return this.work.run(
      async (tx) => {
        await tx.lock(key);
        const now = Date.now(),
          old = await tx.rates.find(key);
        const hits = (old?.hits || []).filter((d) => +d > now - 60000);
        if (hits.length >= limit) return false;
        hits.push(new Date(now));
        await tx.rates.saveHits(key, hits);
        return true;
      },
      { maxWait: 15000, timeout: 15000 },
    );
  }
  private view(
    old: { hits: Date[]; cycles: number; blockedUntil: Date | null } | null,
  ) {
    const now = Date.now();
    return {
      hits: (old?.hits || []).filter(
        (d) => +d > now - this.c.ACCOUNT_WINDOW_MS,
      ),
      cycles: old?.cycles || 0,
      blocked: !!old?.blockedUntil && +old.blockedUntil > now,
    };
  }
  async read(key: string) {
    return this.view(await this.records.find(key));
  }
  async state(tx: AuthTransaction, key: string) {
    return this.view(await tx.rates.find(key));
  }
  async failure(tx: AuthTransaction, key: string, master = false) {
    const s = await this.state(tx, key);
    if (s.blocked) return;
    s.hits.push(new Date());
    const blocked = s.hits.length >= this.c.ACCOUNT_FAILURE_LIMIT;
    const cycles = s.cycles + (blocked ? 1 : 0);
    const base = master
      ? this.c.MASTER_COOLDOWN_BASE_MS
      : this.c.COOLDOWN_BASE_MS;
    const max = master ? this.c.MASTER_COOLDOWN_MAX_MS : this.c.COOLDOWN_MAX_MS;
    const blockedUntil = blocked
      ? new Date(Date.now() + Math.min(base * 2 ** Math.min(s.cycles, 16), max))
      : null;
    const data = { hits: blocked ? [] : s.hits, cycles, blockedUntil };
    await tx.rates.save(key, data);
  }
  async clear(tx: AuthTransaction, key: string) {
    await tx.rates.delete(key);
  }
}
