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

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/admin/audit/organizations?*", (route) =>
    route.fulfill({
      json: {
        items: [{ id, name: "Organização atual" }],
        total: 1,
        page: 1,
        pageSize: 100,
      },
    }),
  );
});

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
  await expect(
    page.getByText("Carregando auditoria…", { exact: true }),
  ).toBeVisible();
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

test("combined filters, local minute boundaries, refresh drafts, reset and unavailable organization", async ({
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
  const queries: URLSearchParams[] = [];
  let unavailable = false;
  const records = Array.from({ length: 12 }, (_, i) => ({
    ...event,
    id: `${id.slice(0, -2)}${String(i).padStart(2, "0")}`,
    occurredAt: "2026-01-02T12:00:45.000Z",
  }));
  await page.route("**/v1/admin/audit?*", (route) => {
    const q = new URL(route.request().url()).searchParams;
    queries.push(q);
    if (unavailable && q.has("organizationId"))
      return route.fulfill({ status: 409, json: {} });
    const all = [
      ...records,
      {
        ...event,
        id: "anonymous",
        organization: null,
        action: "auth.login_failed",
        outcome: "failure",
      },
    ];
    const items = all.filter(
      (row) =>
        (!q.get("organizationId") || row.organization !== null) &&
        (!q.get("action") || q.get("action") === row.action) &&
        (!q.get("outcome") || q.get("outcome") === row.outcome) &&
        (!q.get("from") || row.occurredAt >= q.get("from")!) &&
        (!q.get("to") || row.occurredAt <= q.get("to")!),
    );
    const pageNumber = Number(q.get("page")),
      size = Number(q.get("pageSize"));
    return route.fulfill({
      json: {
        items: items.slice((pageNumber - 1) * size, pageNumber * size),
        total: items.length,
        page: pageNumber,
        pageSize: size,
        actions,
      },
    });
  });
  await page.goto("/admin/audit");
  await expect(page.getByText("13 eventos encontrados")).toBeVisible();
  const org = page.getByRole("combobox", { name: "Organização", exact: true });
  await expect(org).toBeEnabled();
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  await org.selectOption(id);
  await page
    .getByRole("combobox", { name: "Ação", exact: true })
    .selectOption("account.updated");
  await page
    .getByRole("combobox", { name: "Resultado", exact: true })
    .selectOption("success");
  // Derive local wall time from a known instant, preserving the browser's zone.
  const local = await page.evaluate(() => {
    const d = new Date("2026-01-02T12:00:00Z");
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  await page.getByLabel("De", { exact: true }).fill(local);
  await page.getByLabel("Até", { exact: true }).fill(local);
  await page.getByRole("button", { name: "Aplicar filtros" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("12 eventos encontrados")).toBeVisible();
  expect(queries.at(-1)?.get("from")).toBe("2026-01-02T12:00:00.000Z");
  expect(queries.at(-1)?.get("to")).toBe("2026-01-02T12:00:59.999Z");
  expect(queries.at(-1)?.get("organizationId")).toBe(id);
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  // Unapplied drafts cannot change refresh or pagination.
  await org.selectOption("");
  await page
    .getByRole("combobox", { name: "Resultado", exact: true })
    .selectOption("failure");
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(page.getByText("12 eventos encontrados")).toBeVisible();
  expect(queries.at(-1)?.get("organizationId")).toBe(id);
  expect(queries.at(-1)?.get("outcome")).toBe("success");
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  unavailable = true;
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Organização indisponível",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page.getByText("13 eventos encontrados")).toBeVisible();
  await expect(page.getByText("Página 1 de 2")).toBeVisible();
  for (const key of ["from", "to", "action", "outcome", "organizationId"])
    expect(queries.at(-1)?.has(key)).toBe(false);
  await expect(page.getByLabel("De", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Até", { exact: true })).toHaveValue("");
  await expect(org).toHaveValue("");
  await page
    .getByRole("combobox", { name: "Resultado", exact: true })
    .selectOption("failure");
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.getByText("1 eventos encontrados")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Não se aplica", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Página 1 de 1")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Próxima", exact: true }),
  ).toBeDisabled();
});

test("organization option pagination, failure retry and disappearing selection", async ({
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
  await page.route("**/v1/admin/audit/organizations?*", (route) => {
    const second =
      new URL(route.request().url()).searchParams.get("page") === "2";
    return mode === "error"
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: {
            items:
              mode === "removed"
                ? []
                : second
                  ? [{ id, name: "Última organização" }]
                  : Array.from({ length: 100 }, (_, i) => ({
                      id: `org-${i}`,
                      name: `Organização ${i}`,
                    })),
            total: mode === "removed" ? 0 : 101,
          },
        });
  });
  const queries: string[] = [];
  await page.route("**/v1/admin/audit?*", (route) => {
    queries.push(route.request().url());
    return mode === "removed" &&
      new URL(route.request().url()).searchParams.has("organizationId")
      ? route.fulfill({ status: 409, json: {} })
      : route.fulfill({ json: pageData });
  });
  await page.goto("/admin/audit");
  const org = page.getByRole("combobox", { name: "Organização", exact: true });
  await expect(org).toBeDisabled();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "carregar as organizações",
  );
  mode = "ready";
  await page.getByRole("button", { name: "Atualizar opções" }).click();
  await expect(org).toBeEnabled();
  await expect(org.locator("option")).toHaveCount(102);
  await org.selectOption(id);
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect
    .poll(() => new URL(queries.at(-1)!).searchParams.get("organizationId"))
    .toBe(id);
  await expect(page.getByRole("table")).toBeVisible();
  mode = "removed";
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(org.locator("option:checked")).toHaveText(
    "Organização indisponível",
  );
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Organização indisponível",
  );
  const before = queries.length;
  await page.getByRole("button", { name: "Aplicar filtros" }).click();
  await expect(page.locator("#audit-filter-error")).toContainText(
    "Organização indisponível",
  );
  expect(queries.length).toBe(before);
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(org).toHaveValue("");
});

test("refresh corrects a page that no longer exists without stale totals", async ({
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
  let total = 12;
  await page.route("**/v1/admin/audit?*", (route) => {
    const current = Number(
      new URL(route.request().url()).searchParams.get("page"),
    );
    return route.fulfill({
      json: {
        ...pageData,
        items: current === 2 && total === 1 ? [] : [event],
        page: current,
        total,
      },
    });
  });
  await page.goto("/admin/audit");
  await page.getByRole("button", { name: "Próxima", exact: true }).click();
  await expect(page.getByText("Página 2 de 2")).toBeVisible();
  total = 1;
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(page.getByText("Página 1 de 1")).toBeVisible();
  await expect(page.getByText("1 eventos encontrados")).toBeVisible();
});
