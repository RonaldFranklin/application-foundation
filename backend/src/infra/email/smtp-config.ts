import { z } from "zod";
const schema = z.object({
  SMTP_HOST: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.-]+$/),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_SECURE: z.enum(["true", "false"]),
  SMTP_USER: z.string().min(1).max(254),
  SMTP_PASSWORD: z.string().min(1).max(1024),
  EMAIL_FROM: z.email().max(254),
});
export type SmtpConfig =
  | { enabled: false }
  | {
      enabled: true;
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
      from: string;
    };
export function readSmtpConfig(
  env: NodeJS.ProcessEnv,
  queueEnabled: boolean,
): SmtpConfig {
  const flag = z
    .enum(["true", "false"])
    .default("false")
    .safeParse(env.EMAIL_DELIVERY_ENABLED);
  if (!flag.success)
    throw new Error(
      "Configuração inválida: EMAIL_DELIVERY_ENABLED (true ou false)",
    );
  if (flag.data === "false") return { enabled: false };
  if (!queueEnabled)
    throw new Error("EMAIL_DELIVERY_ENABLED requer EMAIL_QUEUE_ENABLED");
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Configuração SMTP inválida: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const c = result.data;
  return {
    enabled: true,
    host: c.SMTP_HOST,
    port: c.SMTP_PORT,
    secure: c.SMTP_SECURE === "true",
    user: c.SMTP_USER,
    password: c.SMTP_PASSWORD,
    from: c.EMAIL_FROM,
  };
}
