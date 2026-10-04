import { ApiBodyOptions } from "@nestjs/swagger";
export const loginBody: ApiBodyOptions = {
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["identifier", "password"],
    properties: {
      identifier: { type: "string", maxLength: 254 },
      password: { type: "string", format: "password", maxLength: 1024 },
      turnstileToken: { type: "string", maxLength: 2048 },
    },
  },
};

export function profileBody(password: boolean): ApiBodyOptions {
  return {
    schema: {
      type: "object",
      additionalProperties: false,
      required: [
        "currentPassword",
        ...(password
          ? ["newPassword", "confirmPassword"]
          : ["username", "email"]),
      ],
      properties: {
        currentPassword: {
          type: "string",
          format: "password",
          minLength: 1,
          maxLength: 1024,
        },
        code: {
          type: "string",
          pattern: "^[0-9]{6}$",
          description: "TOTP novo obrigatório para master; recovery não aceito",
        },
        ...(password
          ? {
              newPassword: {
                type: "string" as const,
                format: "password",
                minLength: 15,
                maxLength: 1024,
              },
              confirmPassword: {
                type: "string" as const,
                format: "password",
                maxLength: 1024,
              },
            }
          : {
              username: {
                type: "string" as const,
                minLength: 1,
                maxLength: 100,
              },
              email: {
                type: "string" as const,
                format: "email",
                maxLength: 254,
              },
            }),
      },
    },
  };
}

export const initialCommonPasswordBody: ApiBodyOptions = {
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["password", "confirmPassword"],
    properties: {
      password: {
        type: "string",
        format: "password",
        writeOnly: true,
        minLength: 15,
        maxLength: 1024,
      },
      confirmPassword: {
        type: "string",
        format: "password",
        writeOnly: true,
        maxLength: 1024,
      },
    },
  },
};

// Optional code extends the existing message body without changing HTTP statuses.
export const authFailureSchema = {
  type: "object" as const,
  required: ["message"],
  properties: {
    message: { type: "string" as const },
    code: {
      type: "string" as const,
      enum: [
        "SESSION_REQUIRED",
        "PASSWORD_REUSED",
        "MFA_INVALID",
        "REAUTHENTICATION_FAILED",
        "ATTEMPTS_BLOCKED",
      ],
    },
  },
};
