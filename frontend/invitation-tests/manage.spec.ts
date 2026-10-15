import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test("organization users offer invitations, safe retry, resend and cancellation with keyboard focus", async ({
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
  await page.route(`**/v1/admin/organizations/${id}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/invitations")) {
      if (route.request().method() === "GET") {
        reads++;
        await holdList;
        if (failList)
          return route.fulfill({ status: 503, json: { code: "UNAVAILABLE" } });
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
  });
  await page.goto(`/admin/organizations/${id}?tab=users`);
  const members = page.getByRole("tab", { name: "Membros", exact: true });
  const invites = page.getByRole("tab", { name: "Convites", exact: true });
  const panel = page.getByRole("tabpanel", { name: "Convites", exact: true });
  await expect(
    page.getByRole("row", { name: /existing-member/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Convites pendentes" }),
  ).toHaveCount(0);
  await members.click();
  await page.keyboard.press("Home");
  await expect(
    page.getByRole("row", { name: /existing-member/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ações de existing-member" }).click();
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
  await expect(page.getByRole("row", { name: /existing-member/ })).toHaveCount(
    0,
  );
  releaseList?.();
  await expect(panel.getByText("Nenhum convite pendente.")).toBeVisible();
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
  await expect(page.locator("#invitation-error")).toContainText("indisponível");
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
    page.getByRole("heading", { name: "Convites pendentes" }),
  ).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: "Reenviar", exact: true }).click();
  await expect.poll(() => resent).toBe(1);
  await expect(
    panel.getByRole("status").filter({ hasText: "enfileirado" }),
  ).toBeVisible();
  await expect(
    panel.getByRole("row", { name: /person@example.invalid/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cancelar convite", exact: true })
    .click();
  await expect(panel.getByText("Nenhum convite pendente.")).toBeVisible();
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
  await expect(panel.getByText("Nenhum convite pendente.")).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  failMembers = true;
  await members.click();
  const memberPanel = page.getByRole("tabpanel", {
    name: "Membros",
    exact: true,
  });
  await expect(memberPanel.getByRole("alert")).toBeVisible();
  await expect(page.getByText("Nenhum convite pendente.")).toHaveCount(0);
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
