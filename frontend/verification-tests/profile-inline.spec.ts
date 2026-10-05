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
test("same inputs, cancel, save authoritative values and reset verified state", async ({
  page,
  request,
}) => {
  await request.post(
    "http://localhost:18631/v1/auth/email-verification/confirm",
    { data: { code: "123456" } },
  );
  await page.goto("/settings");
  const user = page.getByLabel("Usuário", { exact: true }),
    email = page.getByLabel("E-mail", { exact: true });
  await expect(email).toHaveAttribute("readonly", "");
  await expect(page.getByText("✓ Verificado", { exact: true })).toBeVisible();
  await user.evaluate((e) => e.setAttribute("data-original-input", "yes"));
  await email.evaluate((e) => e.setAttribute("data-original-input", "yes"));
  await page
    .getByRole("button", { name: "Editar informações", exact: true })
    .click();
  await expect(user).toBeFocused();
  await expect(email).toBeEditable();
  await expect(email).toHaveAttribute("data-original-input", "yes");
  await expect(page.locator('input[name="email"]')).toHaveCount(1);
  await user.fill("rascunho");
  await email.fill("draft@example.invalid");
  await expect(
    page.getByText("Alteração não salva", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(user).toHaveValue("Pessoa de teste");
  await expect(email).toHaveValue("verification@example.invalid");
  await expect(
    page.getByRole("button", { name: "Editar informações" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Editar informações" }).click();
  await user.fill("  Novo usuário  ");
  await email.fill("NEW@example.invalid");
  await page
    .getByLabel("Senha atual", { exact: true })
    .fill("test-current-password");
  const sent = page.waitForRequest("**/v1/auth/profile");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  expect((await sent).postDataJSON()).toEqual({
    username: "  Novo usuário  ",
    email: "NEW@example.invalid",
    currentPassword: "test-current-password",
  });
  await expect(page.getByText("Informações atualizadas.")).toBeVisible();
  await expect(user).toHaveValue("Novo usuário");
  await expect(email).toHaveValue("new@example.invalid");
  await expect(user).toHaveAttribute("data-original-input", "yes");
  await expect(page.getByText("Não verificado", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Verificar e-mail", exact: true }),
  ).toBeEnabled();
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
        path: `test-results/profile-inline-${width}.png`,
      });
  }
  await page.reload();
  await expect(email).toHaveValue("new@example.invalid");
});
test("failed save restores server values, clears secrets, preserves badge and allows retry", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Editar informações" }).click();
  await page.getByLabel("Usuário", { exact: true }).fill("unsaved");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("unsaved@example.invalid");
  await expect(
    page.getByRole("button", { name: "Verificar e-mail", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Senha atual", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.locator("#profile-error")).toBeVisible();
  await expect(page.getByLabel("Usuário", { exact: true })).toHaveValue(
    "Pessoa de teste",
  );
  await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue(
    "verification@example.invalid",
  );
  await expect(page.getByLabel("Senha atual", { exact: true })).toHaveValue("");
  await page.getByLabel("Usuário", { exact: true }).fill("Retry name");
  await page
    .getByLabel("Senha atual", { exact: true })
    .fill("test-current-password");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Informações atualizadas.")).toBeVisible();
});
test("master preserves MFA confirmation and password fields stay separate", async ({
  page,
  request,
}) => {
  await request.post("http://localhost:18631/reset", {
    data: { master: true },
  });
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: "Editar informações" }).click();
  await expect(page.getByLabel("Código do autenticador")).toBeVisible();
  await page.getByLabel("Usuário", { exact: true }).fill("Master inline");
  await page
    .getByLabel("Senha atual", { exact: true })
    .fill("test-current-password");
  await page.getByLabel("Código do autenticador").fill("654321");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByText("Informações atualizadas.")).toBeVisible();
  await page
    .getByRole("button", { name: "Alterar senha", exact: true })
    .click();
  await expect(page.getByLabel("Usuário", { exact: true })).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(page.getByLabel("Nova senha", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Código do autenticador")).toBeVisible();
});

test("uncertain save never displays draft as persisted and can reload authoritative data", async ({
  page,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Editar informações" }).click();
  await page
    .getByLabel("Usuário", { exact: true })
    .fill("Persisted despite lost read");
  await page
    .getByLabel("Senha atual", { exact: true })
    .fill("test-current-password");
  await page.route("**/v1/welcome", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(
    page.getByRole("button", { name: "Atualizar dados" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Editar informações" }),
  ).toBeDisabled();
  await page.unroute("**/v1/welcome");
  await page.getByRole("button", { name: "Atualizar dados" }).click();
  await expect(page.getByLabel("Usuário", { exact: true })).toHaveValue(
    "Persisted despite lost read",
  );
  await expect(
    page.getByRole("button", { name: "Editar informações" }),
  ).toBeEnabled();
});
