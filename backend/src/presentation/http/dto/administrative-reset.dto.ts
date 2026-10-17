export const resetBody = (password = false, master = true) => ({
  schema: {
    type: "object" as const,
    additionalProperties: false,
    required: [
      "currentPassword",
      ...(master ? ["code"] : []),
      ...(password ? ["temporaryPassword", "confirmPassword"] : []),
    ],
    properties: {
      currentPassword: {
        type: "string" as const,
        minLength: 1,
        maxLength: 1024,
        writeOnly: true,
      },
      code: {
        type: "string" as const,
        pattern: "^[0-9]{6}$",
        writeOnly: true,
        description: "Obrigatório quando o ator tem MFA verificado.",
      },
      ...(password
        ? {
            temporaryPassword: {
              type: "string" as const,
              minLength: 15,
              maxLength: 1024,
              writeOnly: true,
            },
            confirmPassword: {
              type: "string" as const,
              maxLength: 1024,
              writeOnly: true,
            },
          }
        : {}),
    },
  },
});
