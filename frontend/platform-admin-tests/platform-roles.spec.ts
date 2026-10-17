import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roleId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const catalog = {
  "organizations.read": "Consultar organizações",
  "organizations.create": "Criar organizações",
  "organizations.update": "Editar organizações",
  "organizations.status": "Ativar e desativar organizações",
  "organizations.delete": "Excluir e restaurar organizações",
  "audit.read": "Consultar auditoria global",
};
test("Master manages isolated role matrix and assigns roles to accounts and invitations", async ({
  page,
  context,
}, info) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-master",
      domain: "localhost",
      path: "/",
    },
  ]);
  let roles: {
    id: string;
    name: string;
    permissions: string[];
    version: number;
  }[] = [];
  let failSave = true;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  let roleAssigned: string | null = null;
  await page.route("**/v1/admin/platform-admins**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      writes.push({ path, body });
      if (path.endsWith("/roles"))
        roles = [{ id: roleId, ...body, version: 1 }];
      else if (path.endsWith(`/roles/${roleId}`)) {
        if (failSave) {
          failSave = false;
          return route.fulfill({
            status: 503,
            json: { message: "Não foi possível salvar agora." },
          });
        }
        roles = [{ id: roleId, ...body, version: body.version + 1 }];
      } else if (path.endsWith("/remove"))
        return route.fulfill({
          status: 409,
          json: { message: "Cargo associado a uma conta ou convite." },
        });
      else if (path.endsWith("/role")) roleAssigned = body.roleId;
      return route.fulfill({ json: { saved: true, queued: true } });
    }
    if (path.endsWith("/roles"))
      return route.fulfill({ json: { roles, catalog } });
    return route.fulfill({
      json: {
        items: [
          {
            id,
            kind: "account",
            username: "Ana Silva",
            email: "ana@example.invalid",
            permissions: roleAssigned ? roles[0].permissions : [],
            status: "active",
            mfa: true,
            roleId: roleAssigned,
          },
          {
            id: roleId,
            kind: "invitation",
            username: "",
            email: "invite@example.invalid",
            permissions: [],
            status: "pending",
            mfa: false,
            roleId: null,
          },
        ],
        total: 2,
        page: 1,
        pageSize: 10,
        catalog,
        roles,
      },
    });
  });
  await page.goto("/admin/platform-admins");
  const nav = page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("link", { name: "Administradores da plataforma" });
  await expect(nav).toHaveAttribute("aria-current", "page");
  await expect(nav.locator("svg")).toHaveAttribute("aria-hidden", "true");
  const accountsTab = page.getByRole("tab", { name: "Contas e convites" });
  const rolesTab = page.getByRole("tab", { name: "Cargos e permissões" });
  await accountsTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(rolesTab).toBeFocused();
  await expect(
    page.getByText("Nenhum cargo criado.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await page
    .getByRole("textbox", { name: "Nome do novo cargo" })
    .fill("Operação");
  await page.getByRole("button", { name: "Criar cargo", exact: true }).click();
  const matrix = page.getByRole("region", {
    name: "Matriz de permissões da plataforma",
  });
  await expect(matrix).toBeVisible();
  await expect(
    matrix.getByRole("checkbox", {
      name: "Master — Consultar organizações",
      exact: true,
    }),
  ).toBeDisabled();
  const grant = matrix.getByRole("checkbox", {
    name: "Operação — Consultar organizações",
    exact: true,
  });
  await expect(grant).not.toBeChecked();
  await grant.check();
  await expect(accountsTab).toBeDisabled();
  await page.getByRole("button", { name: "Descartar", exact: true }).click();
  await expect(grant).not.toBeChecked();
  await grant.check();
  await page
    .getByRole("button", { name: "Salvar Operação", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Não foi possível salvar agora.",
  );
  await expect(grant).toBeChecked();
  await page
    .getByRole("button", { name: "Salvar Operação", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("atualizados");
  expect(writes.at(-1)?.body.permissions).toEqual(["organizations.read"]);
  for (const width of [1440, 953, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`matrix-${width}.png`),
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Excluir Operação", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar exclusão" })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "associado",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Excluir Operação", exact: true }),
  ).toBeFocused();
  await accountsTab.click();
  await page.getByRole("button", { name: "Ações de Ana Silva" }).click();
  await page
    .getByRole("button", { name: "Atribuir cargo", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Cargo da plataforma" })
    .selectOption(roleId);
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.at(-1)?.body).toEqual({ roleId });
  await expect(
    page.getByRole("cell", { name: "Operação", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Ações de invite@example.invalid" })
    .click();
  await page
    .getByRole("button", { name: "Atribuir cargo", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Cargo da plataforma" })
    .selectOption(roleId);
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.at(-1)?.path).toContain(`/invitations/${roleId}/role`);
  await page.getByRole("button", { name: "Convidar administrador" }).click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("E-mail", { exact: true })
    .fill("new@example.invalid");
  await dialog
    .getByRole("combobox", { name: "Cargo da plataforma" })
    .selectOption(roleId);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Enviar convite" }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.at(-1)?.body).toEqual({ email: "new@example.invalid", roleId });
});

test("roles area exposes loading and retries a failed authorized query", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-master",
      domain: "localhost",
      path: "/",
    },
  ]);
  let fail = true;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/v1/admin/platform-admins**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/roles")) {
      await gate;
      return fail
        ? route.fulfill({
            status: 503,
            json: { message: "Consulta indisponível." },
          })
        : route.fulfill({ json: { roles: [], catalog } });
    }
    return route.fulfill({
      json: { items: [], total: 0, page: 1, pageSize: 10, roles: [], catalog },
    });
  });
  await page.goto("/admin/platform-admins");
  await page.getByRole("tab", { name: "Cargos e permissões" }).click();
  await expect(page.getByText("Carregando cargos…")).toBeVisible();
  release();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Consulta indisponível.",
  );
  fail = false;
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByText("Nenhum cargo criado.", { exact: false }),
  ).toBeVisible();
});
