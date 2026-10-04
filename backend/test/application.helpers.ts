import assert from "node:assert/strict";
import { AuthSettings } from "../src/application/auth/auth-settings";
import {
  AuthRepositories,
  AuthTransaction,
  UnitOfWork,
} from "../src/application/auth/ports/repositories";
import {
  Passwords,
  IdentityProtection,
  Tokens,
  Totp,
  Captcha,
  SecurityEvents,
} from "../src/application/auth/ports/security";
import {
  RateRecord,
  UserRecord,
  SessionWithUser,
} from "../src/domain/auth/models";
import { Login } from "../src/application/auth/use-cases/login";
import { Sessions } from "../src/application/auth/use-cases/sessions";
import { Rates } from "../src/application/auth/use-cases/rate-limits";
import { MasterAdmission } from "../src/application/auth/use-cases/master-admission";
import { ChangeInitialPassword } from "../src/application/auth/use-cases/change-initial-password";
import { BootstrapMaster } from "../src/application/auth/use-cases/bootstrap-master";
import { Mfa } from "../src/application/auth/use-cases/mfa";
import { Cleanup } from "../src/application/auth/use-cases/cleanup";

async function unexpected(): Promise<never> {
  throw new Error("Unexpected repository operation in isolated test");
}
export function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "fixture",
    username: "fixture-name",
    email: "fixture@example.invalid",
    usernameIndex: "i:fixture",
    emailIndex: "i:fixture@example.invalid",
    passwordHash: "fake-hash",
    master: true,
    mustChangePassword: false,
    totpSecret: "fake-totp",
    totpVerified: true,
    lastTotpStep: -1n,
    createdAt: new Date(),
    ...overrides,
  };
}
export function session(owner: UserRecord, stage = "mfa"): SessionWithUser {
  return {
    digest: "d:restricted",
    userId: owner.id,
    stage,
    user: owner,
    expiresAt: new Date(Date.now() + 600000),
    createdAt: new Date(),
  };
}
// Deliberately not an ORM emulator: unexpected queries fail. Real rollback/locks are tested against PostgreSQL.
export function isolated() {
  const trace: string[] = [],
    rateRows = new Map<string, RateRecord>();
  let depth = 0,
    nextToken = 0;
  const settings: AuthSettings = {
    MASTER_USERNAME: "fixture",
    MASTER_EMAIL: "fixture@example.invalid",
    MASTER_INITIAL_PASSWORD: "synthetic initial passphrase",
    ACCOUNT_WINDOW_MS: 900000,
    ACCOUNT_FAILURE_LIMIT: 3,
    COOLDOWN_BASE_MS: 300000,
    COOLDOWN_MAX_MS: 1800000,
    MASTER_COOLDOWN_BASE_MS: 60000,
    MASTER_COOLDOWN_MAX_MS: 300000,
    SESSION_HOURS: 8,
    MASTER_DEVICE_DAYS: 30,
    TURNSTILE_THRESHOLD: 2,
    API_IP_LIMIT: 100,
    LOGIN_IP_LIMIT: 10,
  };
  const repos: AuthRepositories = {
    identities: {
      findMaster: unexpected,
      findByIndex: unexpected,
      findCollision: unexpected,
      findById: unexpected,
      requireById: unexpected,
      create: unexpected,
      updateCredentials: unexpected,
      consumeRecovery: unexpected,
      deleteRecovery: unexpected,
      createRecovery: unexpected,
    },
    sessions: {
      find: unexpected,
      create: unexpected,
      delete: unexpected,
      deleteForUser: unexpected,
      findDevice: unexpected,
      createDevice: unexpected,
      deleteDevice: unexpected,
      deleteDevicesForUser: unexpected,
      deviceDigestsAfter: unexpected,
      deleteDevices: unexpected,
      deleteExpiredSessions: unexpected,
      deleteExpiredDevices: unexpected,
    },
    rates: {
      async find(key) {
        trace.push(`read:${key}`);
        return structuredClone(rateRows.get(key) ?? null);
      },
      async saveHits(key, hits) {
        trace.push(`hits:${key}`);
        rateRows.set(key, {
          hits,
          cycles: rateRows.get(key)?.cycles ?? 0,
          blockedUntil: rateRows.get(key)?.blockedUntil ?? null,
        });
      },
      async save(key, state) {
        trace.push(`save:${key}`);
        rateRows.set(key, structuredClone(state));
      },
      async delete(key) {
        trace.push(`clear:${key}`);
        rateRows.delete(key);
      },
      deleteInactive: unexpected,
    },
  };
  const work: UnitOfWork = {
    async run<T>(action: (tx: AuthTransaction) => Promise<T>) {
      trace.push("begin");
      depth++;
      try {
        return await action({
          ...repos,
          async lock(key) {
            trace.push(`lock:${key}`);
          },
        });
      } finally {
        depth--;
        trace.push("end");
      }
    },
  };
  const passwords: Passwords = {
    dummy: "fake-dummy-hash",
    async init() {
      trace.push("dummy");
    },
    async hash() {
      trace.push(`hash:${depth}`);
      return "new-fake-hash";
    },
    async verify(hash) {
      assert.equal(depth, 0);
      trace.push(`verify:${hash}`);
      return false;
    },
    async run<T>(operation: () => Promise<T>) {
      return operation();
    },
  };
  const vault: IdentityProtection = {
    index: (value, purpose = "identity") =>
      `${purpose}:${value.trim().toLowerCase()}`,
    encrypt: (value) => value,
    decrypt: (value) => value,
  };
  const tokens: Tokens = {
    generate: () => String(++nextToken).padStart(43, "a"),
    digest: (value) => `d:${value}`,
    recoveryCode: () => String(++nextToken).padStart(32, "0"),
  };
  const totp: Totp = {
    generateSecret: () => "fake-totp",
    uri: (value) => `otpauth:${value}`,
    step: () => null,
  };
  const captcha: Captcha = {
    async verify() {
      assert.equal(depth, 0);
      trace.push("captcha");
      return true;
    },
  };
  const events: SecurityEvents = {
    login(event, master) {
      trace.push(`event:${event}:${master}`);
    },
  };
  const rates = new Rates(repos.rates, work, settings, vault);
  const sessions = new Sessions(repos.sessions, work, settings, vault, tokens);
  const admission = new MasterAdmission(work, settings, rates, tokens);
  return {
    trace,
    rateRows,
    repos,
    work,
    settings,
    passwords,
    totp,
    tokens,
    captcha,
    sessions,
    rates,
    admission,
    login: new Login(
      repos.identities,
      work,
      vault,
      rates,
      sessions,
      passwords,
      admission,
      captcha,
      events,
    ),
    password: new ChangeInitialPassword(work, sessions, passwords, tokens),
    bootstrap: new BootstrapMaster(work, settings, vault, passwords),
    mfa: new Mfa(vault, rates, sessions, tokens, totp),
    cleanup: new Cleanup(repos),
  };
}
