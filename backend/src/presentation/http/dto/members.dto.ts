import { ApiBodyOptions, ApiResponseOptions } from "@nestjs/swagger";
import { organizationRoles } from "../../../domain/organizations/models";
const role = { type: "string" as const, enum: [...organizationRoles] };
export function memberBody(
  action: "add" | "update" | "remove",
): ApiBodyOptions {
  if (action !== "add")
    return {
      schema: {
        type: "object",
        additionalProperties: false,
        required: action === "update" ? ["role"] : [],
        properties: action === "update" ? { role } : {},
      },
    };
  return {
    schema: {
      oneOf: ["existing", "new"].map((mode) => ({
        type: "object" as const,
        additionalProperties: false,
        required: [
          "mode",
          "email",
          ...(mode === "new" ? ["username", "password"] : []),
        ],
        properties: {
          mode: { type: "string" as const, enum: [mode] },
          email: { type: "string" as const, format: "email", maxLength: 254 },
          role: { ...role, default: "MEMBER" },
          ...(mode === "new"
            ? {
                username: {
                  type: "string" as const,
                  minLength: 1,
                  maxLength: 100,
                },
                password: {
                  type: "string" as const,
                  minLength: 15,
                  maxLength: 1024,
                  writeOnly: true,
                  description:
                    "Senha temporária; troca obrigatória no primeiro login comum. Entrega das credenciais por canal combinado, sem envio de e-mail.",
                },
              }
            : {}),
        },
      })),
    },
  };
}
export const memberListResponse: ApiResponseOptions = {
  status: 200,
  schema: {
    type: "object",
    required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["userId", "username", "email", "role", "createdAt"],
          properties: {
            userId: { type: "string", format: "uuid" },
            username: { type: "string" },
            email: { type: "string", format: "email" },
            role,
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  },
};
