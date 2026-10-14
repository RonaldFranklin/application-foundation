import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const password = "synthetic organization browser password";
const api = "http://localhost:18731/v1";
async function login(page: Page, username: string) {
  await page.goto("/login");
  await page.getByLabel("E-mail ou usuário").fill(username);
  await page.getByLabel("Senha", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
}
async function masterPost(page: Page, path: string, data: object) {
  const legacy = path.endsWith("/members") && "mode" in data;
  const response = await page.request.post(
    legacy ? "http://127.0.0.1:18732/members" : api + path,
    {
      headers: {
        Origin: "http://localhost:18730",
        Cookie: "login_session=organization-browser-master",
      },
      data: legacy ? { ...data, organizationId: path.split("/")[3] } : data,
    },
  );
  expect(response.status()).toBe(200);
  return response.json();
}

test("single administrator lands directly in the existing tabs and manages only the own organization", async ({
  page,
}) => {
  await login(page, "admin-single");
  await expect(page).toHaveURL(/\/organizations\/[^/]+$/);
  const url = page.url(),
    id = url.split("/").at(-1)!;
  await expect(
    page.getByRole("heading", {
      name: "Admin Single Organization",
      exact: true,
    }),
  ).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(
    nav.getByRole("link", { name: "Organização", exact: true }),
  ).toBeVisible();
  for (const name of ["Ativar", "Desativar", "Excluir", "Restaurar"])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  await page.getByRole("button", { name: "Editar", exact: true }).click();
  await page.getByLabel("Nome da organização").fill("Admin Single Edited");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Admin Single Edited", exact: true }),
  ).toBeVisible();
  let releaseMembers!: () => void;
  const membersReady = new Promise<void>((resolve) => {
    releaseMembers = resolve;
  });
  await page.route("**/organizations/*/members?*", async (route) => {
    await membersReady;
    await route.continue();
  });
  await page.getByRole("link", { name: "Usuários", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Carregando usuários" }),
  ).toBeVisible();
  releaseMembers();
  await expect(page.getByRole("row", { name: /admin-single/ })).toContainText(
    "Seu acesso administrativo é protegido",
  );
  await page.unroute("**/organizations/*/members?*");
  await expect(
    page.getByRole("button", { name: "Ações de admin-single" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Convidar usuário", exact: true }),
  ).toBeVisible();
  await masterPost(page, `/admin/organizations/${id}/members`, {
    mode: "new",
    username: "admin-created-member",
    email: "admin-created-member@example.invalid",
    password,
  });
  await page.reload();
  await expect(
    page.getByRole("row", { name: /admin-created-member/ }),
  ).toContainText("Membro");
  await page
    .getByRole("button", { name: "Ações de admin-created-member" })
    .click();
  await page
    .getByRole("button", { name: "Alterar papel de admin-created-member" })
    .click();
  await page
    .getByLabel("Papel na organização")
    .selectOption("ORGANIZATION_ADMIN");
  await page.getByRole("button", { name: "Salvar papel", exact: true }).click();
  await expect(
    page.getByRole("row", { name: /admin-created-member/ }),
  ).toContainText("Administrador da organização");
  await page
    .getByRole("button", { name: "Ações de admin-created-member" })
    .click();
  await page
    .getByRole("button", { name: "Remover vínculo de admin-created-member" })
    .click();
  await page.getByRole("button", { name: "Confirmar remoção" }).click();
  await expect(
    page.getByRole("row", { name: /admin-created-member/ }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Visualização de vínculos")).toHaveCount(0);
  await page
    .getByRole("link", { name: "Cargos e permissões", exact: true })
    .click();
  const permissions = page.getByRole("form", { name: "Permissões do Membro" });
  await expect(
    permissions
      .getByRole("checkbox", { name: /Administrador da organização/ })
      .first(),
  ).toBeDisabled();
  await permissions
    .getByLabel("Membro — Consultar usuários", { exact: true })
    .check();
  await permissions
    .getByRole("button", { name: "Salvar permissões", exact: true })
    .click();
  await expect(permissions.getByRole("status")).toHaveText(
    "Permissões salvas.",
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await permissions
    .getByLabel("Membro — Consultar usuários", { exact: true })
    .uncheck();
  await permissions
    .getByRole("button", { name: "Salvar permissões", exact: true })
    .click();
  await expect(permissions.getByRole("status")).toHaveText(
    "Permissões salvas.",
  );
  await page.goto("/login");
  await expect(page).toHaveURL(url);
  // A live backend revocation must deny a previously authorized tab without a new login.
  const members = await (
    await page.request.get(`${api}/organizations/${id}/members`)
  ).json();
  await masterPost(page, `/admin/organizations/${id}/members`, {
    mode: "new",
    username: "replacement-admin",
    email: "replacement-admin@example.invalid",
    password,
    role: "ORGANIZATION_ADMIN",
  });
  const actor = members.items.find(
    (m: { username: string }) => m.username === "admin-single",
  );
  await masterPost(
    page,
    `/admin/organizations/${id}/members/${actor.userId}/remove`,
    {},
  );
  await page.goto(`${url}?tab=permissions`);
  await expect(
    page.getByRole("heading", { name: "Sem acesso à organização" }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Permissões do Membro" }),
  ).toHaveCount(0);
});

test("multiple administrative memberships show only administered choices; initial-password login has the same destination", async ({
  page,
}) => {
  await login(page, "admin-multiple");
  await expect(page).toHaveURL(/\/organizations$/);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("link", { name: "Admin Multiple A", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", { name: "Admin Multiple B", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("link", {
      name: "Delegated Member Organization",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    main.getByRole("link", { name: /Admin Single|Inactive Organization/ }),
  ).toHaveCount(0);
  await main
    .getByRole("link", { name: "Admin Multiple A", exact: true })
    .click();
  await expect(page).toHaveURL(/\/organizations\/[^/]+$/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await masterPost(page, `/admin/organizations/${id}/members`, {
    mode: "new",
    username: "temporary-admin",
    email: "temporary-admin@example.invalid",
    password,
    role: "ORGANIZATION_ADMIN",
  });
  await page.context().clearCookies();
  await login(page, "temporary-admin");
  await expect(
    page.getByRole("heading", { name: "Uma senha só sua." }),
  ).toBeVisible();
  await page
    .getByLabel("Nova senha", { exact: true })
    .fill(password + " changed");
  await page
    .getByLabel("Confirmar nova senha", { exact: true })
    .fill(password + " changed");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await expect(page).toHaveURL(new RegExp(`/organizations/${id}$`));
  await expect(
    page.getByRole("link", { name: "Cargos e permissões", exact: true }),
  ).toBeVisible();
});

test("member without grants, removed link and inactive organization have no administrative UI", async ({
  page,
}) => {
  for (const username of ["plain-member", "removed-admin", "inactive-admin"]) {
    await page.context().clearCookies();
    await login(page, username);
    await expect(page).toHaveURL("http://localhost:18730/");
    await expect(
      page
        .getByRole("navigation", { name: "Navegação principal" })
        .getByRole("link", { name: "Organização", exact: true }),
    ).toHaveCount(0);
    await page.goto("/organizations");
    await expect(
      page.getByRole("heading", { name: "Sem acesso à organização" }),
    ).toBeVisible();
    await page.goto(
      "/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?tab=permissions",
    );
    await expect(
      page.getByRole("heading", { name: "Sem acesso à organização" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Cargos e permissões", exact: true }),
    ).toHaveCount(0);
  }
});

test("directory dependency failure is safe and distinguishable from denied access; Master navigation remains global", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "organization-browser-unavailable",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Organização indisponível" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Tentar novamente" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Editar", exact: true }),
  ).toHaveCount(0);
  await context.clearCookies();
  await context.addCookies([
    {
      name: "login_session",
      value: "organization-browser-master",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/admin");
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("link", { name: "Organização", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/organizations$/);
  await expect(
    page.getByRole("heading", { name: "Organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Adicionar organização", exact: true }),
  ).toBeVisible();
});
