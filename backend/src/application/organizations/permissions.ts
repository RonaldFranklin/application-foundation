export const permissionCatalog = {
  "organization.read": "Visualizar organização",
  "organization.update": "Editar dados da organização",
  "members.read": "Consultar usuários",
  "members.create": "Cadastrar usuários",
  "members.link": "Vincular contas existentes",
  "members.roles": "Alterar cargos",
  "members.remove": "Remover vínculos",
  "permissions.manage": "Administrar permissões",
} as const;
export type OrganizationPermission = keyof typeof permissionCatalog;
export const permissionKeys = Object.keys(
  permissionCatalog,
) as OrganizationPermission[];

// Retain the historical key for audit decoding and persisted enum compatibility.
// It is no longer a delegable organizational permission.
export const delegablePermissionKeys = permissionKeys.filter(
  (key) => key !== "members.roles",
);
export const delegablePermissionCatalog = Object.fromEntries(
  delegablePermissionKeys.map((key) => [key, permissionCatalog[key]]),
);
