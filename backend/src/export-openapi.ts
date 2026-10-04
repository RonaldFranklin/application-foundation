import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createApp } from "./app";
import { openapi } from "./presentation/http/openapi";
import { readConfig } from "./infra/config/config";
import { authFailureSchema } from "./presentation/http/dto/auth.dto";
import { cookiePolicy } from "./presentation/http/presenters/cookies";
async function main() {
  // Ephemeral configuration solely for metadata generation; no database connection or real secrets.
  const c = readConfig({
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://unused:unused@localhost:5432/unused",
    FRONTEND_ORIGIN: "http://localhost:3000",
    PUBLIC_API_ORIGIN: "http://localhost:3001",
    ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    HMAC_KEY: randomBytes(32).toString("hex"),
    MASTER_EMAIL: "unused@example.invalid",
    MASTER_INITIAL_PASSWORD: randomBytes(24).toString("hex"),
  });
  const app = await createApp(c);
  const doc = openapi(app, c);
  const schema = (
    properties: Record<string, any>,
    required = Object.keys(properties),
  ) => ({ type: "object", properties, required, additionalProperties: false });
  const stage = {
    type: "string",
    enum: ["password", "setup", "mfa", "recovery", "full"],
  };
  const error = schema({ message: { type: "string" } });
  const authError = { ...authFailureSchema, additionalProperties: false };
  const validationError = schema(
    {
      message: { type: "string" },
      fields: { type: "object", additionalProperties: { type: "string" } },
    },
    ["message"],
  );
  const result = schema(
    {
      stage,
      ok: { type: "boolean" },
      recoveryCodes: {
        type: "array",
        items: { type: "string" },
        description: "Somente na resposta de enrolamento; não recuperável.",
      },
    },
    ["stage"],
  );
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (
        !["get", "post"].includes(method) ||
        !op ||
        typeof op !== "object" ||
        !("responses" in op)
      )
        continue;
      if (path.startsWith("/v1/admin/organizations")) {
        if (method === "post")
          op.parameters = [
            ...(op.parameters ?? []),
            {
              name: "Origin",
              in: "header",
              required: true,
              schema: { type: "string" },
              description:
                "FRONTEND_ORIGIN exata; application/json obrigatório",
            },
          ];
        const organization = schema({
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          active: { type: "boolean" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        });
        op.responses = {
          200: {
            description: "Sucesso; somente sessão plena master",
            content: {
              "application/json": {
                schema:
                  method === "get" && path.endsWith("/organizations")
                    ? schema({
                        items: { type: "array", items: organization },
                        total: { type: "integer" },
                        page: { type: "integer" },
                        pageSize: { type: "integer" },
                      })
                    : organization,
              },
            },
          },
          ...Object.fromEntries(
            [
              [400, "Dados inválidos"],
              [401, "Sessão inválida ou sem acesso à operação."],
              [403, "Origem inválida"],
              [404, "Organização não encontrada"],
              [413, "Payload maior que 8 KiB"],
              [429, "Limite por IP"],
              [500, "Erro inesperado"],
              [503, "Serviço indisponível"],
            ].map(([status, description]) => [
              status,
              {
                description,
                content: {
                  "application/json": {
                    schema: status === 401 ? authError : error,
                  },
                },
              },
            ]),
          ),
        };
        continue;
      }
      const operation = op as any;
      let response: any = result;
      if (path.endsWith("/session"))
        response = schema({ stage, master: { type: "boolean" } });
      if (path.endsWith("/welcome"))
        response = schema({
          message: { type: "string" },
          username: { type: "string" },
          email: { type: "string", format: "email" },
          accountType: { type: "string", enum: ["common", "master"] },
          mfa: schema({
            configured: { type: "boolean" },
            verified: { type: "boolean" },
          }),
        });
      if (path.endsWith("/setup"))
        response = schema({
          secret: { type: "string" },
          uri: { type: "string" },
        });
      if (path.endsWith("/health"))
        response = schema({ status: { type: "string" } });
      operation.responses = {
        200: {
          description: "Sucesso",
          content: { "application/json": { schema: response } },
          headers: {
            "Cache-Control": { schema: { type: "string", enum: ["no-store"] } },
            "Set-Cookie": {
              description:
                "Sessão nas transições; admissão master somente após MFA completo. Ambos HttpOnly e nunca aparecem no JSON.",
              schema: { type: "string" },
            },
          },
        },
        401: {
          description: path.endsWith("/login")
            ? "E-mail ou senha inválidos."
            : "Sessão inválida ou operação recusada; code opcional identifica causas seguras.",
          content: {
            "application/json": {
              schema: path.endsWith("/login")
                ? schema({
                    message: { type: "string" },
                    challengeRequired: {
                      type: "boolean",
                      description:
                        "Sempre false no login comum; no master, pressão global do endpoint, independente do identificador.",
                    },
                  })
                : authError,
            },
          },
        },
        403: {
          description: "Origin, Fetch Metadata ou Content-Type recusados",
        },
        413: { description: "Payload maior que 8 KiB" },
        429: {
          description: "Limite por IP",
          headers: {
            "Retry-After": { schema: { type: "integer", example: 60 } },
          },
        },
        503: { description: "Banco/serviço indisponível" },
      };
      if (
        path.endsWith("/password") ||
        path.endsWith("/initial-password") ||
        path.endsWith("/profile")
      )
        operation.responses[400] = {
          description:
            "Revise os campos; senha de 15–1024 caracteres e confirmação correspondente quando exigida.",
          content: { "application/json": { schema: validationError } },
        };
      if (path.endsWith("/logout")) {
        operation.responses[400] = {
          description: "Corpo inválido; forgetDevice deve ser booleano",
        };
        delete operation.responses[200];
        operation.responses[204] = {
          description: "Revogada; também retorna sucesso se já ausente",
        };
      }
      if (path.endsWith("/login") || path.endsWith("/health"))
        operation.security = [];
      if (method === "post")
        operation.parameters = [
          {
            name: "Origin",
            in: "header",
            required: true,
            schema: { type: "string" },
            description:
              "FRONTEND_ORIGIN exata; requisição deve usar application/json",
          },
        ];
      if (path === "/v1/admin/auth/login")
        operation.parameters.push({
          name: cookiePolicy(c.PUBLIC_API_ORIGIN).deviceName,
          in: "cookie",
          required: false,
          schema: { type: "string" },
          description:
            "Admissão opcional emitida após MFA; não autentica nem dispensa senha, CAPTCHA ou MFA.",
        });
    }
  }
  writeFileSync("openapi.json", JSON.stringify(doc, null, 2) + "\n");
  await app.close();
}
void main();
