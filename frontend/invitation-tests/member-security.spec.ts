import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
for (const master of [true, false]) {
  test(`${master ? "Master" : "Organization admin"}: member metadata, MFA reset authorization and accessible dialog`, async ({
    page,
    context,
  }, info) => {
    await context.addCookies([
      {
        name: "login_session",
        value: "synthetic-invitation-ui",
        domain: "localhost",
        path: "/",
      },
    ]);
    let deleted = false,
      reset = false,
      attempts = 0;
    await page.route(
      `**/v1/${master ? "admin/" : ""}organizations/${id}**`,
      async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith("/members")) {
          deleted = url.searchParams.get("deleted") === "true";
          return route.fulfill({
            json: {
              items: [
                {
                  canResetCredentials: true,
                  userId: id,
                  username: "Maria Silva",
                  email: "maria@example.invalid",
                  role: "MEMBER",
                  createdAt: "2026-01-01",
                  deletedAt: deleted ? "2026-01-02" : null,
                  organization: { id, name: "Organização de teste" },
                  mfa: { configured: !reset, verified: !reset },
                  lastLoginAt: reset ? null : "2026-10-16T12:34:00.000Z",
                },
              ],
              resetRequiresMfa: master,
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
            permissions: [],
          },
        });
      },
    );
    await page.route(
      `**/v1/${master ? "admin/" : ""}accounts/${id}/mfa/reset`,
      async (route) => {
        expect(route.request().postDataJSON()).toEqual({
          currentPassword: "Synthetic current password",
          ...(master ? { code: "123456" } : {}),
        });
        attempts++;
        if (attempts === 1)
          return route.fulfill({ status: 401, json: { code: "MFA_INVALID" } });
        reset = true;
        return route.fulfill({ json: { ok: true } });
      },
    );
    await page.goto(`/${master ? "admin/" : ""}organizations/${id}?tab=users`);
    const table = page.getByRole("region", { name: "Usuários vinculados" });
    await expect(table.getByRole("columnheader")).toHaveText([
      "Membro",
      "Cargo",
      "Organização",
      "Status",
      "Autenticação",
      "Último acesso",
      "Ações",
    ]);
    await expect(table.getByText("MS", { exact: true })).toBeVisible();
    await expect(table.getByText("Organização de teste")).toBeVisible();
    await expect(table.getByText("Vínculo ativo")).toBeVisible();
    await expect(table.getByText("TOTP verificado")).toBeVisible();
    await expect(table.locator("time")).toHaveAttribute(
      "datetime",
      "2026-10-16T12:34:00.000Z",
    );
    const menu = table.getByRole("button", { name: "Ações de Maria Silva" });
    await menu.click();
    const action = page.getByRole("button", {
      name: "Redefinir autenticação de dois fatores",
      exact: true,
    });
    expect(
      await action.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await action.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Sua senha atual")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(menu).toBeFocused();
    await menu.click();
    await action.click();
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`reset-${width}.png`) });
    }
    await dialog
      .getByLabel("Sua senha atual")
      .fill("Synthetic current password");
    if (master)
      await dialog.getByLabel("Código do seu autenticador").fill("123456");
    else
      await expect(dialog.getByLabel("Código do seu autenticador")).toHaveCount(
        0,
      );
    await dialog.getByRole("button", { name: "Confirmar redefinição" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Código inválido");
    await expect(dialog.getByLabel("Sua senha atual")).toHaveValue("");
    await dialog
      .getByLabel("Sua senha atual")
      .fill("Synthetic current password");
    if (master)
      await dialog.getByLabel("Código do seu autenticador").fill("123456");
    await dialog.getByRole("button", { name: "Confirmar redefinição" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(table.getByText("TOTP não configurado")).toBeVisible();
    await expect(table.getByText("Nunca acessou")).toBeVisible();
    await page.route(
      `**/v1/${master ? "admin/" : ""}accounts/${id}/password/reset`,
      (route) => {
        expect(route.request().postDataJSON()).toEqual({
          currentPassword: "Synthetic current password",
          ...(master ? { code: "123456" } : {}),
          temporaryPassword: "Temporary per-account password",
          confirmPassword: "Temporary per-account password",
        });
        return route.fulfill({ json: { ok: true } });
      },
    );
    await menu.click();
    await page
      .getByRole("button", { name: "Redefinir senha", exact: true })
      .click();
    await expect(dialog).toContainText("Maria Silva");
    await expect(dialog).toContainText("canal apropriado");
    await dialog
      .getByLabel("Senha temporária", { exact: true })
      .fill("Temporary per-account password");
    await dialog
      .getByLabel("Confirmar senha temporária")
      .fill("Temporary per-account password");
    await dialog
      .getByLabel("Sua senha atual")
      .fill("Synthetic current password");
    if (master)
      await dialog.getByLabel("Código do seu autenticador").fill("123456");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await dialog.getByRole("button", { name: "Confirmar redefinição" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText("Troca obrigatória");
    if (!master) return;
    await page
      .getByRole("combobox", { name: "Visualização de vínculos" })
      .selectOption("true");
    await expect(table.getByText("Vínculo removido")).toBeVisible();
  });
}
