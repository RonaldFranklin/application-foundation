import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const event = {
  id,
  occurredAt: "2026-01-02T12:00:00.000Z",
  action: "account.updated",
  actionLabel: "Dados da conta alterados",
  outcome: "success",
  actor: "Nome atual",
  organization: "Organização atual",
  resource: "Conta: Nome atual",
  resourceType: "Conta",
};
const actions = [
  { value: "account.updated", label: "Dados da conta alterados" },
  { value: "auth.login_failed", label: "Login recusado" },
];
const pageData = { items: [event], total: 12, page: 1, pageSize: 10, actions };

test("Master navigation, loading, filters, server pagination, keyboard modal and responsive accessibility", async ({
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
  const queries: URLSearchParams[] = [];
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/admin/audit?*", async (route) => {
    const query = new URL(route.request().url()).searchParams;
    queries.push(query);
    await pending;
    await route.fulfill({
      json: {
        ...pageData,
        page: Number(query.get("page")),
        pageSize: Number(query.get("pageSize")),
      },
    });
  });
  let detailCalls = 0;
  await page.route(`**/v1/admin/audit/${id}`, (route) => {
    detailCalls++;
    return route.fulfill({
      json: {
        ...event,
        metadata: [{ label: "Campos alterados", value: "Usuário" }],
      },
    });
  });
  await page.goto("/admin");
  const link = page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("link", { name: "Auditoria", exact: true });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await expect(page.getByRole("status")).toHaveText("Carregando auditoria…");
  release!();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(link).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect.poll(() => queries.at(-1)?.get("page")).toBe("2");
  await expect(page.getByText("Página 2 de 2", { exact: true })).toBeVisible();
  await page.getByLabel("Itens por página").selectOption("5");
  await expect.poll(() => queries.at(-1)?.get("pageSize")).toBe("5");
  expect(queries.at(-1)?.get("page")).toBe("1");
  await page
    .getByRole("combobox", { name: "Ação", exact: true })
    .selectOption("account.updated");
  await page
    .getByRole("combobox", { name: "Resultado", exact: true })
    .selectOption("success");
  await page.getByLabel("De", { exact: true }).fill("2026-01-01T10:00");
  await page.getByLabel("Até", { exact: true }).fill("2026-01-02T16:00");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect
    .poll(() => queries.at(-1)?.get("action"))
    .toBe("account.updated");
  expect(queries.at(-1)?.get("outcome")).toBe("success");
  expect(queries.at(-1)?.get("from")).toMatch(/2026-01-01T.*Z$/);
  const trigger = page.getByRole("button", { name: /^Ver detalhes:/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const modal = page.getByRole("dialog", { name: "Detalhes do evento" });
  await expect(
    modal.getByText("Campos alterados", { exact: true }),
  ).toBeVisible();
  // Development Strict Mode may start and abort the first GET.
  expect(detailCalls).toBeGreaterThanOrEqual(1);
  await expect(modal.getByRole("button", { name: "Fechar" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(modal.getByRole("button", { name: "Fechar" })).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(trigger).toBeFocused();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`audit-list-${width}.png`) });
    await trigger.click();
    await expect(
      modal.getByText("Campos alterados", { exact: true }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`audit-${width}.png`) });
    expect(
      await modal.evaluate((node) => node.scrollWidth <= node.clientWidth),
    ).toBe(true);
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect.poll(() => queries.at(-1)?.has("action")).toBe(false);
  await page.getByLabel("De", { exact: true }).fill("2026-02-02T10:00");
  await page.getByLabel("Até", { exact: true }).fill("2026-01-01T10:00");
  const count = queries.length;
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "início do período",
  );
  expect(queries.length).toBe(count);
});

test("empty, failure, retry, unavailable references and absent metadata", async ({
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
  let mode = "error";
  await page.route("**/v1/admin/audit?*", (route) =>
    mode === "error"
      ? route.fulfill({
          status: 503,
          json: { message: "private error must not display" },
        })
      : route.fulfill({
          json: {
            ...pageData,
            items:
              mode === "empty"
                ? []
                : [
                    {
                      ...event,
                      actor: "Sistema ou ator não identificado",
                      organization: null,
                    },
                  ],
            total: mode === "empty" ? 0 : 1,
          },
        }),
  );
  let detailError = true;
  await page.route(`**/v1/admin/audit/${id}`, (route) =>
    detailError
      ? route.fulfill({ status: 404, json: {} })
      : route.fulfill({
          json: {
            ...event,
            actor: "Conta não disponível",
            organization: "Organização não disponível",
            metadata: [],
          },
        }),
  );
  await page.goto("/admin/audit");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "temporariamente indisponível",
  );
  await expect(page.getByText("private error must not display")).toHaveCount(0);
  mode = "empty";
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByRole("heading", { name: "Nenhum evento encontrado" }),
  ).toBeVisible();
  mode = "ready";
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Não se aplica", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Ver detalhes:/ }).click();
  const modal = page.getByRole("dialog");
  await expect(modal.getByRole("alert")).toContainText("Evento não encontrado");
  detailError = false;
  await modal.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    modal.getByText("Nenhum detalhe adicional foi registrado."),
  ).toBeVisible();
  await expect(
    modal.getByText("Organização não disponível", { exact: true }),
  ).toBeVisible();
  await modal.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByRole("table")).toBeVisible();
});

for (const kind of ["admin", "member"])
  test(`organizational ${kind} has no Audit navigation and cannot open the page`, async ({
    page,
    context,
  }) => {
    await context.addCookies([
      {
        name: "login_session",
        value: `synthetic-${kind}`,
        domain: "localhost",
        path: "/",
      },
    ]);
    await page.goto("/settings");
    await expect(
      page
        .getByRole("navigation", { name: "Navegação principal" })
        .getByRole("link", { name: "Auditoria" }),
    ).toHaveCount(0);
    await page.goto("/admin/audit");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(
      page.getByRole("heading", { name: "Auditoria", exact: true }),
    ).toHaveCount(0);
  });

test("missing session redirects before rendering audit", async ({ page }) => {
  await page.goto("/admin/audit");
  await expect(page).toHaveURL(/\/admin\/login$/);
});
