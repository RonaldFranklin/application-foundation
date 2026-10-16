import { SchemaObject } from "@nestjs/swagger";
export const auditSummarySchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "occurredAt",
    "action",
    "actionLabel",
    "outcome",
    "actor",
    "organization",
    "resource",
    "resourceType",
  ],
  properties: {
    id: {
      type: "string",
      format: "uuid",
      description: "ID do evento, não de pessoa ou organização",
    },
    occurredAt: { type: "string", format: "date-time" },
    action: { type: "string" },
    actionLabel: { type: "string" },
    outcome: { type: "string", enum: ["success", "failure"] },
    actor: {
      type: "string",
      description: "Nome de usuário atual ou indicação de indisponibilidade",
    },
    organization: { type: "string", nullable: true },
    resource: { type: "string" },
    resourceType: { type: "string" },
  },
};
export const auditDetailSchema: SchemaObject = {
  ...auditSummarySchema,
  required: [...auditSummarySchema.required!, "metadata"],
  properties: {
    ...auditSummarySchema.properties,
    metadata: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: { label: { type: "string" }, value: { type: "string" } },
      },
    },
  },
};
export const auditPageSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["items", "total", "page", "pageSize", "actions"],
  properties: {
    items: { type: "array", maxItems: 100, items: auditSummarySchema },
    total: { type: "integer" },
    page: { type: "integer" },
    pageSize: { type: "integer", maximum: 100 },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["value", "label"],
        properties: { value: { type: "string" }, label: { type: "string" } },
      },
    },
  },
};
