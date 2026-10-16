import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const catalog = {
  "organizations.read": "Consultar organizações",
  "organizations.create": "Criar organizações",
  "organizations.update": "Editar organizações",
  "organizations.status": "Ativar e desativar organizações",
  "organizations.delete": "Excluir e restaurar organizações",
  "audit.read": "Consultar auditoria global",
};
test("Master manages explicit grants and invitations with accessible confirmations, filters and responsive layout", async ({
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
  const rows = [
    {
      id,
      kind: "account",
      email: "delegate@example.invalid",
      username: "Delegado",
      permissions: ["organizations.read"],
      status: "active",
      mfa: false,
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "invitation",
      email: "invited@example.invalid",
      username: "",
      permissions: [],
      status: "pending",
      mfa: false,
    },
  ];
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/v1/admin/platform-admins**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      writes.push({
        path: new URL(req.url()).pathname,
        body: req.postDataJSON(),
      });
      return route.fulfill({ json: { saved: true } });
    }
    const q = new URL(req.url()).searchParams;
    const items = rows.filter(
      (r) =>
        (q.get("status") === "all" || q.get("status") === r.status) &&
        r.email.includes(q.get("search") ?? ""),
    );
    return route.fulfill({
      json: { items, total: items.length, page: 1, pageSize: 10, catalog },
    });
  });
  await page.goto("/admin/platform-admins");
  await expect(
    page.getByRole("heading", {
      name: "Administradores da plataforma",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("MFA pendente")).toBeVisible();
  await page.getByRole("button", { name: "Convidar administrador" }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await dialog
    .getByLabel("E-mail", { exact: true })
    .fill("new@example.invalid");
  await dialog.getByLabel("Consultar organizações", { exact: true }).check();
  await dialog.getByRole("button", { name: "Enviar convite" }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes.at(-1)?.body).toEqual({
    email: "new@example.invalid",
    permissions: ["organizations.read"],
  });
  await page.getByRole("button", { name: "Permissões", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByLabel("Consultar auditoria global"),
  ).not.toBeChecked();
  await dialog.getByLabel("Consultar auditoria global").check();
  await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(writes.at(-1)?.body.permissions).toEqual([
    "organizations.read",
    "audit.read",
  ]);
  await page.getByRole("button", { name: "Desativar", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "encerrar todas as sessões",
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Desativar", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Cancelar convite" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Confirmar", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(writes.at(-1)?.path).toMatch(/\/revoke$/);
  await page
    .getByRole("combobox", { name: "Estado", exact: true })
    .selectOption("inactive");
  await expect(
    page.getByText("Nenhuma conta ou convite encontrado."),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Estado", exact: true })
    .selectOption("all");
  await expect(
    page.getByText("delegate@example.invalid", { exact: false }),
  ).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }
  await page.getByRole("button", { name: "Convidar administrador" }).click();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("delegated navigation and direct routes respect server profile permissions", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-delegate-reader",
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.route("**/v1/admin/organizations?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id,
            name: "Organização",
            active: true,
            deletedAt: null,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      },
    }),
  );
  await page.goto("/admin/organizations");
  await expect(
    page.getByRole("heading", { name: "Organizações", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", {
      name: "Administradores da plataforma",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Auditoria", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Adicionar organização" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Ver usuários" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ações de Organização" }).click();
  await expect(
    page.getByRole("button", { name: "Editar", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Excluir", exact: true }),
  ).toHaveCount(0);
  await page.goto("/admin/platform-admins");
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/audit");
  await expect(page).toHaveURL(/\/admin$/);
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-delegate",
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.goto("/admin/organizations");
  await expect(page).toHaveURL(/\/admin$/);
});
test("activation removes token fragment, defines own password and directs to mandatory MFA login", async ({
  page,
}) => {
  let payload: Record<string, unknown> | undefined;
  await page.route("**/v1/platform-admin-invitations/accept", (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { accepted: true } });
  });
  const token = `${id}.${"a".repeat(43)}`;
  await page.goto(`/admin/invitations/accept#token=${token}`);
  await expect(page.getByLabel("Nome de usuário")).toBeVisible();
  expect(page.url()).not.toContain("#");
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
  await page.getByLabel("Nome de usuário").fill("delegado");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Synthetic secure password");
  await page.getByLabel("Confirmar senha").fill("Synthetic secure password");
  await page.getByRole("button", { name: "Ativar conta" }).click();
  await expect(
    page.getByRole("link", { name: "Ir ao login administrativo" }),
  ).toBeVisible();
  expect(payload?.token).toBe(token);
  await expect(page.getByRole("status")).toContainText(
    "configure o autenticador",
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("management exposes loading and recoverable errors without losing explicit selections", async ({
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
    if (route.request().method() === "POST")
      return route.fulfill({
        status: 503,
        json: { message: "Fila indisponível. Tente novamente." },
      });
    await gate;
    return fail
      ? route.fulfill({
          status: 503,
          json: { message: "Consulta indisponível." },
        })
      : route.fulfill({
          json: { items: [], total: 0, page: 1, pageSize: 10, catalog },
        });
  });
  await page.goto("/admin/platform-admins");
  await expect(page.getByText("Carregando administradores…")).toBeVisible();
  release();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Consulta indisponível.",
  );
  fail = false;
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "Convidar administrador" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("E-mail", { exact: true })
    .fill("retry@example.invalid");
  await dialog.getByLabel("Consultar organizações", { exact: true }).check();
  await dialog.getByRole("button", { name: "Enviar convite" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Fila indisponível. Tente novamente.",
  );
  await expect(
    dialog.getByLabel("Consultar organizações", { exact: true }),
  ).toBeChecked();
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Convidar administrador" }),
  ).toBeFocused();
});

test("create-only grant exposes creation without requesting or revealing the organization directory", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-delegate-creator",
      domain: "localhost",
      path: "/",
    },
  ]);
  let reads = 0;
  let creates = 0;
  await page.route("**/v1/admin/organizations**", (route) => {
    if (route.request().method() === "GET") reads++;
    else creates++;
    return route.fulfill({
      json: { id, name: "Nova organização", active: true },
    });
  });
  await page.goto("/admin/organizations");
  await expect(
    page.getByRole("button", { name: "Adicionar organização" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Tabela de organizações" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Adicionar organização" }).click();
  await page.getByLabel("Nome da organização").fill("Nova organização");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByText("Organização salva.")).toBeVisible();
  expect(creates).toBe(1);
  expect(reads).toBe(0);
});

test("Master resets a platform administrator with password and fresh TOTP", async ({
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
  let configured = true;
  await page.route("**/v1/admin/platform-admins?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id,
            kind: "account",
            username: "Delegado",
            email: "delegate@example.invalid",
            permissions: [],
            status: "active",
            mfa: configured,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
        catalog,
      },
    }),
  );
  await page.route(`**/v1/admin/accounts/${id}/mfa/reset`, (route) => {
    expect(route.request().postDataJSON()).toEqual({
      currentPassword: "Synthetic password",
      code: "123456",
    });
    configured = false;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/admin/platform-admins");
  const action = page.getByRole("button", {
    name: "Redefinir autenticação de dois fatores",
    exact: true,
  });
  await action.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Sua senha atual").fill("Synthetic password");
  await dialog.getByLabel("Código do seu autenticador").fill("123456");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Confirmar redefinição" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("MFA pendente")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Administradores da plataforma",
      exact: true,
    }),
  ).toBeFocused();
});
