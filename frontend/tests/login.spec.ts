import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
test.beforeEach(async ({ page }) => {
  await page.route(
    `${process.env.PUBLIC_API_ORIGIN || "http://localhost:3001"}/**`,
    async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ message: "E-mail ou senha inválidos." }),
      });
    },
  );
});
for (const [name, width, height] of [
  ["desktop", 1440, 1000],
  ["mobile", 390, 844],
  ["small", 320, 700],
] as const) {
  test(`layout ${name}, labels, OAuth inert and accessibility`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Bem-vindo de volta." }),
    ).toBeVisible();
    await expect(page.getByLabel("E-mail ou usuário")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Google — em breve" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Apple — em breve" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    const a = await new AxeBuilder({ page }).analyze();
    expect(a.violations).toEqual([]);
    await page.getByLabel("E-mail ou usuário").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Senha", { exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Mostrar senha" }).click();
    await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );
    await page.getByRole("button", { name: "Ocultar senha" }).click();
    await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute(
      "type",
      "password",
    );
  });
}
test("generic error linked to fields; no browser token storage", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("E-mail ou usuário").fill("fixture");
  await page.getByLabel("Senha", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("#form-error")).toHaveText(
    "E-mail ou senha inválidos.",
  );
  await expect(page.getByLabel("Senha", { exact: true })).toHaveAttribute(
    "aria-describedby",
    "form-error",
  );
  expect(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
  ).toBe(0);
});
test("admin route distinct and missing Turnstile safely prevents arbitrary challenge submission", async ({
  page,
}) => {
  await page.route("**/v1/admin/auth/login", (r) =>
    r.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        message: "E-mail ou senha inválidos.",
        challengeRequired: true,
      }),
    }),
  );
  await page.goto("/admin/login");
  await expect(page.getByText("ACESSO MASTER", { exact: true })).toBeVisible();
  await page.getByLabel("E-mail ou usuário").fill("fixture");
  await page.getByLabel("Senha", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByText(/administrador precisa configurar/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Entrar", exact: true }),
  ).toBeDisabled();
});
test("first access UI password, TOTP and once-only recovery confirmation", async ({
  page,
}) => {
  await page.route("**/v1/admin/auth/login", (r) =>
    r.fulfill({ json: { stage: "password" } }),
  );
  await page.route("**/v1/admin/auth/password", (r) =>
    r.fulfill({ json: { stage: "setup" } }),
  );
  await page.route("**/v1/admin/auth/totp/setup", (r) =>
    r.fulfill({ json: { secret: "FICTITIOUSKEY" } }),
  );
  await page.route("**/v1/admin/auth/totp/enroll", (r) =>
    r.fulfill({
      json: { stage: "recovery", recoveryCodes: ["fixture-recovery-code"] },
    }),
  );
  await page.goto("/admin/login");
  await page.getByLabel("E-mail ou usuário").fill("fixture");
  await page.getByLabel("Senha", { exact: true }).fill("fixture");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Uma senha só sua." }),
  ).toBeFocused();
  await page.getByLabel("Nova senha").fill("fictional long passphrase");
  await page.getByRole("button", { name: "Salvar nova senha" }).click();
  await page
    .getByRole("button", { name: "Exibir chave de configuração" })
    .click();
  await expect(page.getByLabel("Chave de configuração")).toHaveValue(
    "FICTITIOUSKEY",
  );
  await page.getByLabel("Código de 6 dígitos").fill("123456");
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(
    page.getByRole("list", { name: "Códigos de recuperação" }),
  ).toContainText("fixture-recovery-code");
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("strict CSP uses a fresh response nonce and rendered scripts carry it", async ({
  page,
}) => {
  const first = await page.goto("/login");
  const firstPolicy = first?.headers()["content-security-policy"] || "";
  const firstNonce = /'nonce-([^']+)'/.exec(firstPolicy)?.[1];
  expect(firstNonce).toBeTruthy();
  // The dev server intentionally permits inline styles. Authentication scripts
  // must still use nonces; assert the script directive rather than style-src.
  const scripts = firstPolicy
    .split(";")
    .find((d) => d.trim().startsWith("script-src"));
  expect(scripts).not.toContain("'unsafe-inline'");
  expect(scripts).toContain("'strict-dynamic'");
  const scriptNonces = await page
    .locator("script[nonce]")
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLScriptElement).nonce),
    );
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((nonce) => nonce === firstNonce)).toBeTruthy();

  const second = await page.request.get("/login");
  const secondNonce = /'nonce-([^']+)'/.exec(
    second.headers()["content-security-policy"] || "",
  )?.[1];
  expect(secondNonce).toBeTruthy();
  expect(secondNonce).not.toBe(firstNonce);
});

test("frontend server protects welcome pages without cookie", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  for (const path of [
    "/settings",
    "/admin",
    "/admin/settings",
    "/admin/organizations",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(
      path.startsWith("/admin") ? /\/admin\/login$/ : /\/login$/,
    );
    await expect(
      page.getByRole("navigation", { name: "Navegação principal" }),
    ).toHaveCount(0);
  }
});
