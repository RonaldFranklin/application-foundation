import { Organization } from "../../../domain/organizations/models";
export interface OrganizationQuery {
  search: string;
  active?: boolean;
  page: number;
  pageSize: number;
}
export interface OrganizationPage {
  items: Organization[];
  total: number;
  page: number;
  pageSize: number;
}
export interface OrganizationsRepository {
  create(name: string): Promise<Organization>;
  list(query: OrganizationQuery): Promise<OrganizationPage>;
  find(id: string): Promise<Organization | null>;
  update(
    id: string,
    data: { name?: string; active?: boolean },
  ): Promise<Organization | null>;
}
