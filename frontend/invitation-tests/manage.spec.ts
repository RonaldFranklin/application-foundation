import { invitationPage } from "./listing-fixture";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
async function openOrganizationUsers(
  page: Page,
  id: string,
  master: boolean,
  testInfo: TestInfo,
) {
  if (!master) {
    await page.goto(`/organizations/${id}?tab=users`);
    return;
  }
  await page.route(
    (url) => url.pathname === "/v1/admin/organizations",
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id,
              name: "Organização de teste",
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
  const list = page.getByRole("region", { name: "Tabela de organizações" });
  await expect(list).toBeVisible();
  await expect(page.locator("#members")).toHaveCount(0);
  const link = list
    .getByRole("row", { name: /Organização de teste/ })
    .getByRole("link", { name: "Ver usuários", exact: true });
  await expect(link).toHaveAttribute(
    "href",
    `/admin/organizations/${id}?tab=users`,
  );
  await page.screenshot({
    path: testInfo.outputPath("master-organizations-list.png"),
    fullPage: true,
  });
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    new RegExp(`/admin/organizations/${id}\\?tab=users$`),
  );
  await expect(
    page.getByRole("tab", { name: "Membros", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(list).toHaveCount(0);
}

for (const master of [true, false]) {
  const namespace = master ? "admin/" : "";
  const contextName = master ? "Master" : "Administrador";
  test(`${contextName}: organization users offer invitations, safe retry, resend and cancellation with keyboard focus`, async ({
    page,
    context,
  }, testInfo) => {
    await context.addCookies([
      {
        name: "login_session",
        value: "synthetic-invitation-ui",
        domain: "localhost",
        path: "/",
      },
    ]);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    let pending = false,
      fail = true,
      resent = 0,
      reads = 0,
      failList = false;
    let failMembers = false;
    let memberRole = "MEMBER";
    let releaseList: (() => void) | undefined;
    let holdList: Promise<void> | undefined;
    await page.route(
      `**/v1/${namespace}organizations/${id}**`,
      async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/invitations")) {
          if (route.request().method() === "GET") {
            reads++;
            await holdList;
            if (failList)
              return route.fulfill({
                status: 503,
                json: { code: "UNAVAILABLE" },
              });
            return route.fulfill({
              json: invitationPage(
                pending
                  ? [
                      {
                        id,
                        email: "person@example.invalid",
                        role: "MEMBER",
                        expiresAt: "2030-01-01T00:00:00.000Z",
                      },
                    ]
                  : [],
                route.request().url(),
              ),
            });
          }
          expect(route.request().postDataJSON()).toEqual({
            email: "person@example.invalid",
            role: "MEMBER",
          });
          if (fail) {
            fail = false;
            return route.fulfill({
              status: 503,
              json: { code: "UNAVAILABLE", message: "raw SMTP details" },
            });
          }
          pending = true;
          return route.fulfill({ json: { queued: true } });
        }
        if (path.endsWith("/resend")) {
          resent++;
          return route.fulfill({ json: { queued: true } });
        }
        if (path.endsWith("/revoke")) {
          pending = false;
          return route.fulfill({ json: { revoked: true } });
        }
        if (path.endsWith(`/members/${id}`)) {
          memberRole = route.request().postDataJSON().role;
          return route.fulfill({ json: { updated: true } });
        }
        if (path.endsWith("/members")) {
          if (failMembers) return route.fulfill({ status: 503, json: {} });
          return route.fulfill({
            json: {
              items: [
                {
                  userId: id,
                  username: "existing-member",
                  email: "member@example.invalid",
                  role: memberRole,
                },
              ],
              total: 1,
              page: 1,
              pageSize: 10,
            },
          });
        }
        return route.fulfill({
          json: {
            id,
            name: "Organização de teste",
            active: true,
            deletedAt: null,
            createdAt: "2026-01-01",
            updatedAt: "2026-01-01",
          },
        });
      },
    );
    await page.setViewportSize({ width: 953, height: 635 });
    await openOrganizationUsers(page, id, master, testInfo);
    const members = page.getByRole("tab", { name: "Membros", exact: true });
    const invites = page.getByRole("tab", { name: "Convites", exact: true });
    const panel = page.getByRole("tabpanel", { name: "Convites", exact: true });
    await expect(
      page.getByRole("row", { name: /existing-member/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Convites", exact: true }),
    ).toHaveCount(0);
    await members.click();
    await page.keyboard.press("Home");
    await expect(
      page.getByRole("row", { name: /existing-member/ }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Ações de existing-member" })
      .click();
    await page
      .getByRole("button", { name: "Alterar papel de existing-member" })
      .click();
    await page
      .getByRole("combobox", { name: "Papel na organização", exact: true })
      .selectOption("ORGANIZATION_ADMIN");
    await page.getByRole("button", { name: "Salvar papel" }).click();
    await expect(
      page.getByRole("row", { name: /existing-member/ }),
    ).toContainText("Administrador da organização");
    await page.locator("#members").screenshot({
      path: testInfo.outputPath("organization-users-desktop.png"),
    });
    expect(reads).toBe(0);
    holdList = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    await members.focus();
    await page.keyboard.press("ArrowRight");
    await expect(invites).toBeFocused();
    await expect(panel.getByText("Carregando convites…")).toBeVisible();
    await expect(
      page.getByRole("row", { name: /existing-member/ }),
    ).toHaveCount(0);
    releaseList?.();
    await expect(panel.getByText("Nenhum convite encontrado.")).toBeVisible();
    const trigger = page.getByRole("button", {
      name: "Convidar usuário",
      exact: true,
    });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("E-mail do convite")).toBeFocused();
    await expect(page.getByLabel("Senha temporária")).toHaveCount(0);
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(trigger).toBeFocused();
    await members.click();
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Convidar usuário" });
    await expect(dialog).toBeVisible();
    await expect(page.getByLabel("E-mail do convite")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Cancelar", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByLabel("E-mail do convite").fill("person@example.invalid");
    await page.getByRole("button", { name: "Enviar convite" }).click();
    await expect(page.locator("#invitation-error")).toContainText(
      "indisponível",
    );
    await expect(page.getByText("raw SMTP details")).toHaveCount(0);
    await page.getByRole("button", { name: "Enviar convite" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(invites).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByText("1 membro · 1 convite pendente", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: /person@example.invalid/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Convites", exact: true }),
    ).toBeFocused();
    await page.locator("#members").screenshot({
      path: testInfo.outputPath("invitations-reference-953.png"),
    });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page
      .getByRole("button", {
        name: "Ações do convite para person@example.invalid",
      })
      .click();
    await page.getByRole("button", { name: "Reenviar", exact: true }).click();
    await expect.poll(() => resent).toBe(1);
    await expect(
      panel.getByRole("status").filter({ hasText: "enfileirado" }),
    ).toBeVisible();
    await expect(
      panel.getByRole("row", { name: /person@example.invalid/ }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Ações do convite para person@example.invalid",
      })
      .click();
    await page
      .getByRole("button", { name: "Cancelar convite", exact: true })
      .click();
    await expect(panel.getByText("Nenhum convite encontrado.")).toBeVisible();
    await expect(panel.getByRole("status")).toHaveText("Convite cancelado.");
    await members.click();
    await expect(page.getByText("Convite cancelado.")).toHaveCount(0);
    await expect(
      page.getByRole("row", { name: /existing-member/ }),
    ).toBeVisible();
    failList = true;
    await members.focus();
    await page.keyboard.press("End");
    await expect(invites).toBeFocused();
    await expect(panel.getByRole("alert")).toContainText("indisponível");
    failList = false;
    await panel.getByRole("button", { name: "Atualizar convites" }).click();
    await expect(panel.getByText("Nenhum convite encontrado.")).toBeVisible();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    failMembers = true;
    await members.click();
    const memberPanel = page.getByRole("tabpanel", {
      name: "Membros",
      exact: true,
    });
    await expect(memberPanel.getByRole("alert")).toBeVisible();
    await expect(page.getByText("Nenhum convite encontrado.")).toHaveCount(0);
    failMembers = false;
    await memberPanel.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(
      page.getByRole("row", { name: /existing-member/ }),
    ).toBeVisible();
    pending = true;
    await invites.click();
    await expect(
      panel.getByRole("row", { name: /person@example.invalid/ }),
    ).toBeVisible();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await expect(trigger).toBeVisible();
      await page
        .locator("#members")
        .screenshot({ path: testInfo.outputPath(`invitations-${width}.png`) });
      await trigger.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("dialog").screenshot({
        path: testInfo.outputPath(`organization-invite-${width}.png`),
      });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page
          .getByRole("dialog")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await invites.focus();
      await page.keyboard.press("Home");
      await expect(members).toBeFocused();
      await expect(
        page.getByRole("row", { name: /existing-member/ }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.keyboard.press("ArrowLeft");
      await expect(invites).toBeFocused();
    }
  });

  test(`${contextName}: dense member panel: reference viewport, filters, pagination and mobile captures`, async ({
    page,
    context,
  }, testInfo) => {
    await context.addCookies([
      {
        name: "login_session",
        value: "synthetic-ui",
        domain: "localhost",
        path: "/",
      },
    ]);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const people = Array.from({ length: 12 }, (_, index) => ({
      userId: `synthetic-${index}`,
      username: `membro-${String(index + 1).padStart(2, "0")}`,
      email: `membro${index + 1}@example.invalid`,
      role: index % 3 ? "MEMBER" : "ORGANIZATION_ADMIN",
      deletedAt: null,
    }));
    await page.route(`**/v1/${namespace}organizations/${id}**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/members")) {
        const search = url.searchParams.get("search") || "";
        const role = url.searchParams.get("role");
        const page = Number(url.searchParams.get("page")),
          size = Number(url.searchParams.get("pageSize"));
        const filtered = people.filter(
          (p) => p.username.includes(search) && (!role || p.role === role),
        );
        return route.fulfill({
          json: {
            items: filtered.slice((page - 1) * size, page * size),
            total: filtered.length,
            page,
            pageSize: size,
          },
        });
      }
      return route.fulfill({
        json: {
          id,
          name: "Organização de teste",
          active: true,
          deletedAt: null,
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        },
      });
    });
    await page.setViewportSize({ width: 953, height: 635 });
    await openOrganizationUsers(page, id, master, testInfo);
    await expect(page.getByRole("row", { name: /membro-10/ })).toBeVisible();
    await page
      .locator("#members")
      .screenshot({ path: testInfo.outputPath("members-reference-953.png") });
    await page.screenshot({
      path: testInfo.outputPath("page-reference-953.png"),
      fullPage: true,
    });
    await expect(
      page.getByRole("navigation", { name: "Paginação de usuários" }),
    ).toContainText("1–10 de 12");
    await page.getByRole("button", { name: "Próxima", exact: true }).click();
    await expect(page.getByRole("row", { name: /membro-12/ })).toBeVisible();
    await page
      .getByRole("combobox", { name: "Filtrar por cargo" })
      .selectOption("MEMBER");
    await expect(page.getByRole("row", { name: /membro-01/ })).toHaveCount(0);
    await page
      .getByRole("searchbox", { name: "Buscar usuários" })
      .fill("membro-02");
    await expect(page.getByRole("row", { name: /membro-02/ })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Paginação de usuários" }),
    ).toContainText("1–1 de 1");
    await page.getByRole("button", { name: "Limpar filtros" }).click();
    await expect(page.getByRole("row", { name: /membro-10/ })).toBeVisible();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page
        .locator("#members")
        .screenshot({ path: testInfo.outputPath(`members-${width}.png`) });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
  });
}

test("Master and organization administrator share panel structure and computed styles", async ({
  page,
  context,
}, testInfo) => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const actor = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-parity",
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.route(`**/v1/**organizations/${id}**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/members"))
      return route.fulfill({
        json: {
          items: [
            {
              userId: id,
              username: "other-member",
              email: "other@example.invalid",
              role: "MEMBER",
              deletedAt: null,
            },
            {
              userId: actor,
              username: "org-admin",
              email: "admin@example.invalid",
              role: "ORGANIZATION_ADMIN",
              deletedAt: null,
            },
          ],
          total: 2,
          page: 1,
          pageSize: 10,
        },
      });
    if (path.endsWith("/invitations"))
      return route.fulfill({
        json: invitationPage(
          [
            {
              id,
              email: "invited@example.invalid",
              role: "MEMBER",
              expiresAt: "2030-01-01",
            },
          ],
          route.request().url(),
        ),
      });
    return route.fulfill({
      json: {
        id,
        name: "Organização de teste",
        active: true,
        deletedAt: null,
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    });
  });
  const stylesByWidth = new Map<number, unknown>();
  for (const master of [true, false]) {
    const name = master ? "master" : "organization-admin";
    await page.setViewportSize({ width: 953, height: 635 });
    await openOrganizationUsers(page, id, master, testInfo);
    const panel = page.locator("#members");
    await expect(
      panel.getByRole("row", { name: /other-member/ }),
    ).toBeVisible();
    await expect(
      panel.getByRole("tab", { name: "Membros", exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      panel.getByRole("button", { name: "Convidar usuário", exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole("combobox", { name: "Visualização de vínculos" }),
    ).toHaveCount(master ? 1 : 0);
    await expect(
      panel.getByRole("button", { name: "Ações de org-admin", exact: true }),
    ).toHaveCount(master ? 1 : 0);
    await expect(
      panel.getByText("Seu acesso administrativo é protegido."),
    ).toHaveCount(master ? 0 : 1);
    await expect(
      page.getByRole("button", { name: "Desativar", exact: true }),
    ).toHaveCount(master ? 1 : 0);
    for (const width of [953, 390, 320]) {
      await page.setViewportSize({ width, height: width === 953 ? 635 : 850 });
      const appearance = await panel.evaluate((root) => {
        const properties = [
          "backgroundColor",
          "color",
          "fontSize",
          "fontFamily",
          "fontWeight",
          "borderRadius",
          "borderTopWidth",
          "borderTopColor",
          "padding",
          "lineHeight",
        ] as const;
        const selectors = [
          ":scope",
          ":scope > header",
          "h2",
          "[role=tablist]",
          "[role=tab]",
          "input[type=search]",
          "table",
          "thead th",
          "tbody td",
          "footer",
        ];
        return selectors.map((selector) => {
          const element =
            selector === ":scope" ? root : root.querySelector(selector)!;
          const style = getComputedStyle(element);
          return {
            selector,
            columns:
              selector === "table"
                ? Array.from(element.querySelectorAll("thead th")).map(
                    (column) =>
                      Math.round(column.getBoundingClientRect().width),
                  )
                : undefined,
            tag: element.tagName,
            className: element.className,
            styles: Object.fromEntries(properties.map((p) => [p, style[p]])),
          };
        });
      });
      if (master) stylesByWidth.set(width, appearance);
      else expect(appearance).toEqual(stylesByWidth.get(width));
      await panel.screenshot({
        path: testInfo.outputPath(`${name}-${width}.png`),
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await panel.getByRole("tab", { name: "Convites", exact: true }).click();
    await expect(
      panel.getByRole("row", { name: /invited@example.invalid/ }),
    ).toBeVisible();
    await panel
      .getByRole("button", {
        name: "Ações do convite para invited@example.invalid",
      })
      .click();
    await expect(
      panel.getByRole("button", { name: "Reenviar", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  }
  // Restricted common account: same layout, read-only capabilities supplied by SSR.
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-readonly",
      domain: "localhost",
      path: "/",
    },
  ]);
  await page.goto(`/organizations/${id}?tab=users`);
  const panel = page.locator("#members");
  await expect(panel.getByRole("row", { name: /other-member/ })).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Convidar usuário" }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "Ações de other-member" }),
  ).toHaveCount(0);
  await panel.getByRole("tab", { name: "Convites", exact: true }).click();
  await expect(
    panel.getByRole("row", { name: /invited@example.invalid/ }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: /Ações do convite/ }),
  ).toHaveCount(0);
});
