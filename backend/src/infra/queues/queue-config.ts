import { z } from "zod";

const enabled = z.enum(["true", "false"]).default("false");
const connection = z.object({
  REDIS_HOST: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.:-]+$/),
  REDIS_PORT: z.coerce.number().int().min(1).max(65535).default(6379),
  REDIS_PASSWORD: z.string().regex(/^[a-fA-F0-9]{64}$/),
});
export type QueueConfig =
  | { enabled: false }
  | { enabled: true; host: string; port: number; password: string };

export function readQueueConfig(env: NodeJS.ProcessEnv): QueueConfig {
  const flag = enabled.safeParse(env.EMAIL_QUEUE_ENABLED);
  if (!flag.success)
    throw new Error(
      "Configuração inválida: EMAIL_QUEUE_ENABLED (true ou false)",
    );
  if (flag.data === "false") return { enabled: false };
  const result = connection.safeParse(env);
  if (!result.success)
    throw new Error(
      `Configuração da fila inválida: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  return {
    enabled: true,
    host: result.data.REDIS_HOST,
    port: result.data.REDIS_PORT,
    password: result.data.REDIS_PASSWORD,
  };
}
