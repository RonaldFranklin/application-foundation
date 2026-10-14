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
