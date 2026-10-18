import { SchemaObject } from "@nestjs/swagger";
const text = (maxLength: number, writeOnly = false): SchemaObject => ({
  type: "string",
  maxLength,
  ...(writeOnly ? { writeOnly: true } : {}),
});
const object = (
  properties: Record<string, SchemaObject>,
  required = Object.keys(properties),
): SchemaObject => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
const password: SchemaObject = { ...text(1024, true), minLength: 15 };
const token: SchemaObject = {
  ...text(80, true),
  description: "Capacidade recebida por e-mail, id.token; uso único.",
};
const email: SchemaObject = { ...text(254), format: "email" };
export const customerBodies = {
  empty: object({}),
  login: object({ email, password: text(1024, true) }),
  invite: object({ email }),
  profile: object({ name: { ...text(100), minLength: 1 } }),
  accept: object({
    token,
    name: { ...text(100), minLength: 1 },
    password,
    confirmPassword: password,
  }),
  reset: object({ token, password, confirmPassword: password }),
  code: object({ code: text(64, true) }),
  setup: object({ password: text(1024, true), code: text(64, true) }, [
    "password",
  ]),
  disable: object({ password: text(1024, true), code: text(64, true) }),
  status: object({ status: { type: "string", enum: ["active", "suspended"] } }),
  revoke: {
    oneOf: [
      object({ id: { type: "string", format: "uuid" } }),
      object({ others: { type: "boolean", enum: [true] } }),
    ],
  } as SchemaObject,
};
