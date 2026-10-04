import "dotenv/config";
import { z } from "zod";
const positive = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = z
    .object({
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      PORT: positive(3001),
      DATABASE_URL: z.string().startsWith("postgresql://"),
      FRONTEND_ORIGIN: z.string().url(),
      PUBLIC_API_ORIGIN: z.string().url(),
      ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
      HMAC_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
      KEY_VERSION: z
        .string()
        .regex(/^[a-z0-9-]{1,16}$/)
        .default("v1"),
      MASTER_USERNAME: z.string().min(1).max(100).default("Ronald"),
      MASTER_EMAIL: z.email().max(254),
      MASTER_INITIAL_PASSWORD: z
        .string()
        .min(15)
        .max(1024)
        .refine((value) => Array.from(value).length >= 15),
      TRUST_PROXY: z.string().default(""),
      TURNSTILE_SECRET_KEY: z.string().optional(),
      TURNSTILE_HOSTNAME: z.string().optional(),
      LOGIN_IP_LIMIT: positive(10),
      API_IP_LIMIT: positive(100),
      ACCOUNT_FAILURE_LIMIT: positive(3),
      ACCOUNT_WINDOW_MS: positive(900000),
      COOLDOWN_BASE_MS: positive(300000),
      COOLDOWN_MAX_MS: positive(1800000),
      MASTER_DEVICE_DAYS: z.coerce.number().int().min(1).max(30).default(30),
      MASTER_COOLDOWN_BASE_MS: positive(60000),
      MASTER_COOLDOWN_MAX_MS: positive(300000),
      TURNSTILE_THRESHOLD: positive(2),
      SESSION_HOURS: positive(8),
      PASSWORD_HASH_CONCURRENCY: positive(4),
    })
    .safeParse(env);
  if (!c.success)
    throw new Error(
      `Configuração inválida: ${c.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const v = c.data;
  if (v.PASSWORD_HASH_CONCURRENCY > 32)
    throw new Error("PASSWORD_HASH_CONCURRENCY não pode exceder 32");
  if (
    v.MASTER_COOLDOWN_BASE_MS > v.COOLDOWN_BASE_MS ||
    v.MASTER_COOLDOWN_MAX_MS > v.COOLDOWN_MAX_MS ||
    v.MASTER_COOLDOWN_BASE_MS > v.MASTER_COOLDOWN_MAX_MS
  )
    throw new Error(
      "Cooldown master deve ser menor ou igual ao cooldown comum",
    );
  if (v.ENCRYPTION_KEY.toLowerCase() === v.HMAC_KEY.toLowerCase())
    throw new Error("Chaves de criptografia e HMAC devem ser diferentes");
  for (const name of ["FRONTEND_ORIGIN", "PUBLIC_API_ORIGIN"] as const) {
    const u = new URL(v[name]);
    if (!["http:", "https:"].includes(u.protocol) || u.origin !== v[name])
      throw new Error(`${name} deve conter somente a origem`);
    if (v.NODE_ENV === "production" && u.protocol !== "https:")
      throw new Error("HTTPS obrigatório");
  }
  if (
    new URL(v.FRONTEND_ORIGIN).hostname !==
    new URL(v.PUBLIC_API_ORIGIN).hostname
  )
    throw new Error(
      "Frontend e API precisam compartilhar hostname para cookie host-only e SSR",
    );
  if (
    v.NODE_ENV === "production" &&
    (!v.TURNSTILE_SECRET_KEY ||
      !v.TURNSTILE_HOSTNAME ||
      v.TURNSTILE_SECRET_KEY.startsWith("1x") ||
      v.TURNSTILE_SECRET_KEY.startsWith("2x") ||
      v.TURNSTILE_SECRET_KEY.startsWith("3x"))
  )
    throw new Error("Turnstile de produção obrigatório");
  return v;
}
export type Config = ReturnType<typeof readConfig>;
