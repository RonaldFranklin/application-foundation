import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ request, context }) => {
  await request.post("http://localhost:18631/reset");
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-session",
      domain: "localhost",
      path: "/",
    },
  ]);
});
test("optional notice, keyboard modal, errors, cooldown, success and persistence", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByText("Seu e-mail ainda não foi verificado.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Verificar e-mail nas configurações" })
    .click();
  const button = page.getByRole("button", {
    name: "Verificar e-mail",
    exact: true,
  });
  await expect(page.getByText("Não verificado", { exact: true })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await button.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Verificar e-mail" }),
    code = dialog.getByLabel("Código de seis dígitos");
  await expect(dialog).toBeVisible();
  await expect(code).toBeFocused();
  await expect(
    dialog.getByRole("button", { name: /Reenviar código em/ }),
  ).toBeDisabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (width !== 320)
      await page.screenshot({
        path: `test-results/email-verification-${width}.png`,
      });
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(button).toBeFocused();
  await button.click();
  await code.fill("999999");
  await dialog.getByRole("button", { name: "Confirmar código" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Código incorreto. Confira os seis dígitos.",
  );
  for (const [errorCode, message] of [
    ["CODE_EXPIRED", "Código expirado. Solicite um novo código."],
    [
      "ATTEMPT_LIMIT",
      "Limite de tentativas atingido. Solicite um novo código.",
    ],
    [
      "CODE_USED",
      "Código já utilizado ou invalidado. Solicite um novo código.",
    ],
  ]) {
    await page.route("**/email-verification/confirm", (route) =>
      route.fulfill({ status: 400, json: { code: errorCode } }),
    );
    await dialog.getByRole("button", { name: "Confirmar código" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(message);
    await page.unroute("**/email-verification/confirm");
  }
  await code.fill("123456");
  await dialog.getByRole("button", { name: "Confirmar código" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText("✓ Verificado", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("✓ Verificado", { exact: true })).toBeVisible();
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: "Verificar e-mail nas configurações" }),
  ).toHaveCount(0);
});
test("request failure and resend keep safe feedback and accessible cancellation", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.route("**/email-verification/request", (route) =>
    route.fulfill({ status: 503, json: { message: "private provider data" } }),
  );
  await page
    .getByRole("button", { name: "Verificar e-mail", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Verificação do e-mail", exact: true })
      .getByRole("alert"),
  ).toHaveText("Verificação temporariamente indisponível. Tente novamente.");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.unroute("**/email-verification/request");
  await page.clock.install();
  await page
    .getByRole("button", { name: "Verificar e-mail", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.clock.fastForward(61000);
  await page.route("**/email-verification/request", (route) =>
    route.fulfill({
      status: 429,
      json: { code: "SEND_LIMIT", retryAfter: 300 },
    }),
  );
  await dialog
    .getByRole("button", { name: "Reenviar código", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Limite de envios atingido. Tente novamente mais tarde.",
  );
  await expect(
    dialog.getByRole("button", { name: /Reenviar código em/ }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).not.toBeVisible();
});
