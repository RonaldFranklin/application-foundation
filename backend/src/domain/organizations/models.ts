export interface Organization {
  id: string;
  name: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const organizationRoles = ["MEMBER", "ORGANIZATION_ADMIN"] as const;
export type OrganizationRole = (typeof organizationRoles)[number];
export interface OrganizationMember {
  userId: string;
  username: string;
  email: string;
  role: OrganizationRole;
  createdAt: Date;
}
