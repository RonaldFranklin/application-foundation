import { ApiBodyOptions } from "@nestjs/swagger";
export function organizationBody(update: boolean): ApiBodyOptions {
  return {
    schema: {
      type: "object",
      additionalProperties: false,
      minProperties: 1,
      required: update ? [] : ["name"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
        ...(update ? { active: { type: "boolean" as const } } : {}),
      },
    },
  };
}
