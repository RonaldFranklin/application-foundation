import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("organization users offer invitations, safe retry, resend and cancellation with keyboard focus", async ({
  page,
  context,
}) => {
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
    resent = 0;
  await page.route(`**/v1/admin/organizations/${id}**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/invitations")) {
      if (route.request().method() === "GET")
        return route.fulfill({
          json: {
            items: pending
              ? [
                  {
                    id,
                    email: "person@example.invalid",
                    role: "MEMBER",
                    expiresAt: "2030-01-01T00:00:00.000Z",
                  },
                ]
              : [],
          },
        });
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
  await page.goto(`/admin/organizations/${id}?tab=users`);
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
  await trigger.click();
  await page.getByLabel("E-mail do convite").fill("person@example.invalid");
  await page.getByRole("button", { name: "Enviar convite" }).click();
  await expect(page.locator("#invitation-error")).toContainText("indisponível");
  await expect(page.getByText("raw SMTP details")).toHaveCount(0);
  await page.getByRole("button", { name: "Enviar convite" }).click();
  await expect(
    page.getByRole("row", { name: /person@example.invalid/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Convites pendentes" }),
  ).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Reenviar", exact: true }).click();
  expect(resent).toBe(1);
  await page
    .getByRole("button", { name: "Cancelar convite", exact: true })
    .click();
  await expect(page.getByText("Nenhum convite pendente.")).toBeVisible();
});
