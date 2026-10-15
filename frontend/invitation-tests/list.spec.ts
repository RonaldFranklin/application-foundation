import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { invitationPage, type FixtureInvitation } from "./listing-fixture";

for (const master of [true, false]) {
  test(`invitation listing and lifecycle (${master ? "Master" : "administrator"})`, async ({
    page,
    context,
  }, testInfo) => {
    await context.addCookies([
      {
        name: "login_session",
        value: "synthetic-listing",
        domain: "localhost",
        path: "/",
      },
    ]);
    const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      namespace = master ? "admin/" : "";
    const items: FixtureInvitation[] = Array.from(
      { length: 14 },
      (_, index) => ({
        id: `invite-${index}`,
        email: `guest-${String(index).padStart(2, "0")}@example.invalid`,
        role: index === 0 ? "ORGANIZATION_ADMIN" : "MEMBER",
        createdBy: "criador-real-da-fixture",
        createdAt: "2026-10-01T12:00:00Z",
        deliveredAt: index === 0 ? null : "2026-10-02T12:00:00Z",
        expiresAt: index < 7 ? "2030-01-01" : "2020-01-01",
        status:
          index < 7
            ? "pending"
            : index < 10
              ? "expired"
              : index < 12
                ? "accepted"
                : "revoked",
      }),
    );
    await page.route(`**/v1/${namespace}organizations/${id}**`, (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/invitations"))
        return route.fulfill({
          json: invitationPage(items, route.request().url()),
        });
      if (path.endsWith("/resend") || path.endsWith("/revoke")) {
        const item = items.find((i) => path.includes(`/${i.id}/`))!;
        if (path.endsWith("/resend")) {
          item.status = "pending";
          item.expiresAt = "2030-01-01";
          item.deliveredAt = null;
        } else item.status = "revoked";
        return route.fulfill({ json: { queued: true } });
      }
      if (path.endsWith("/members"))
        return route.fulfill({
          json: { items: [], total: 0, page: 1, pageSize: 10 },
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
    await page.setViewportSize({ width: 1280, height: 850 });
    await page.goto(`/${namespace}organizations/${id}?tab=users`);
    await page.getByRole("tab", { name: "Convites", exact: true }).click();
    const panel = page.getByRole("tabpanel", { name: "Convites", exact: true });
    await expect(
      panel.getByText(
        "14 resultados · 7 pendentes · 3 expirados na organização",
      ),
    ).toBeVisible();
    await expect(panel.getByRole("row", { name: /guest-00/ })).toContainText(
      "Aguardando envio",
    );
    await expect(panel.getByRole("row", { name: /guest-01/ })).toContainText(
      "02/10/2026",
    );
    await expect(panel.getByRole("row", { name: /guest-00/ })).toContainText(
      "criador-real-da-fixture",
    );
    await page
      .locator("#members")
      .screenshot({ path: testInfo.outputPath("invitations-desktop.png") });
    const filter = panel.getByRole("combobox", { name: "Status do convite" });
    await filter.selectOption("expired");
    await expect(panel.getByRole("row", { name: /guest-07/ })).toBeVisible();
    await panel
      .getByRole("button", {
        name: "Ações do convite para guest-07@example.invalid",
      })
      .focus();
    await page.keyboard.press("Enter");
    await expect(
      panel.getByRole("button", { name: "Cancelar convite", exact: true }),
    ).toHaveCount(0);
    await panel.getByRole("button", { name: "Reenviar", exact: true }).click();
    await expect(panel.getByRole("row", { name: /guest-07/ })).toHaveCount(0);
    await expect(
      panel.getByText(
        "2 resultados · 8 pendentes · 2 expirados na organização",
      ),
    ).toBeVisible();
    for (const state of ["accepted", "revoked"]) {
      await filter.selectOption(state);
      await expect(panel.getByRole("row")).toHaveCount(3);
      await expect(
        panel.getByRole("button", { name: /Ações do convite/ }),
      ).toHaveCount(0);
    }
    await filter.selectOption("all");
    await panel.getByRole("searchbox").fill("GUEST-12");
    await expect(panel.getByRole("row", { name: /guest-12/ })).toBeVisible();
    await expect(
      panel.getByRole("navigation", { name: "Paginação de convites" }),
    ).toContainText("1–1 de 1");
    await panel.getByRole("searchbox").fill("missing");
    await expect(panel.getByText("Nenhum convite encontrado.")).toBeVisible();
    await panel.getByRole("searchbox").fill("");
    await panel
      .getByRole("combobox", { name: "Itens por página" })
      .selectOption("5");
    await expect(panel.getByRole("row", { name: /guest-04/ })).toBeVisible();
    await panel.getByRole("button", { name: "Próxima", exact: true }).click();
    await expect(
      panel.getByRole("navigation", { name: "Paginação de convites" }),
    ).toContainText("6–10 de 14");
    await filter.selectOption("pending");
    await expect(panel.getByRole("row", { name: /guest-00/ })).toBeVisible();
    await panel.getByRole("button", { name: "Próxima", exact: true }).click();
    for (const index of [5, 6, 7]) {
      await panel
        .getByRole("button", {
          name: `Ações do convite para guest-0${index}@example.invalid`,
        })
        .click();
      await panel
        .getByRole("button", { name: "Cancelar convite", exact: true })
        .click();
      await expect(
        panel.getByRole("row", { name: new RegExp(`guest-0${index}`) }),
      ).toHaveCount(0);
    }
    await expect(panel.getByRole("row", { name: /guest-00/ })).toBeVisible();
    await expect(
      panel.getByRole("navigation", { name: "Paginação de convites" }),
    ).toContainText("1–5 de 5");
    for (const width of [940, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await page
        .locator("#members")
        .screenshot({ path: testInfo.outputPath(`invitations-${width}.png`) });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await panel
        .getByRole("region", { name: "Lista de convites", exact: true })
        .focus();
      await page.keyboard.press("ArrowRight");
    }
  });
}

test("member without role-management cannot manage administrative invitations", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-invite-no-roles",
      domain: "localhost",
      path: "/",
    },
  ]);
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  await page.route(`**/v1/organizations/${id}**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/invitations"))
      return route.fulfill({
        json: invitationPage(
          [
            {
              id: "admin-invite",
              email: "admin-invite@example.invalid",
              role: "ORGANIZATION_ADMIN",
              expiresAt: "2030-01-01",
            },
            {
              id: "member-invite",
              email: "member-invite@example.invalid",
              role: "MEMBER",
              expiresAt: "2030-01-01",
            },
          ],
          route.request().url(),
        ),
      });
    if (path.endsWith("/members"))
      return route.fulfill({
        json: { items: [], total: 0, page: 1, pageSize: 10 },
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
  await page.goto(`/organizations/${id}?tab=users`);
  await page.getByRole("tab", { name: "Convites", exact: true }).click();
  await expect(
    page.getByRole("row", { name: /admin-invite@example.invalid/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Ações do convite para admin-invite@example.invalid",
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Ações do convite para member-invite@example.invalid",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Convidar usuário", exact: true })
    .click();
  await expect(
    page.getByRole("option", { name: "Administrador da organização" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
});
