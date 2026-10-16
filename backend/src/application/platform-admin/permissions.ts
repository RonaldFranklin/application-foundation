export const platformPermissionCatalog = {
  "organizations.read": "Consultar organizações",
  "organizations.create": "Criar organizações",
  "organizations.update": "Editar organizações",
  "organizations.status": "Ativar e desativar organizações",
  "organizations.delete": "Excluir e restaurar organizações",
  "audit.read": "Consultar auditoria global",
} as const;
export type PlatformPermission = keyof typeof platformPermissionCatalog;
export const platformPermissionKeys = Object.keys(
  platformPermissionCatalog,
) as [PlatformPermission, ...PlatformPermission[]];
