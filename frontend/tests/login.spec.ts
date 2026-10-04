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

test("first access errors stay in the password form and sanitize server failures", async ({
  page,
}) => {
  await page.route("**/v1/auth/session", (route) =>
    route.fulfill({ json: { stage: "password", master: false } }),
  );
  await page.goto("/login");
  for (const [status, data, message] of [
    [
      401,
      { code: "PASSWORD_REUSED" },
      "A nova senha deve ser diferente da senha atual.",
    ],
    [
      400,
      {
        message:
          "Use uma nova senha de 15 a 1024 caracteres e repita a mesma senha na confirmação.",
      },
      "15 a 1024",
    ],
    [429, {}, "Muitas tentativas"],
    [503, { message: "database secret" }, "temporariamente indisponível"],
    [
      500,
      { message: "SQL internal trace", fields: { password: "secret" } },
      "Não foi possível concluir",
    ],
  ] as const) {
    await page.route("**/v1/auth/initial-password", (route) =>
      route.fulfill({ status, json: data }),
    );
    await page
      .getByLabel("Nova senha", { exact: true })
      .fill("synthetic new passphrase");
    await page
      .getByLabel("Confirmar nova senha", { exact: true })
      .fill("synthetic new passphrase");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.locator("#form-error")).toContainText(message);
    await expect(page.getByLabel("Nova senha", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.getByLabel("Nova senha", { exact: true }),
    ).toHaveAttribute("aria-describedby", "form-error");
    await expect(
      page.getByRole("button", { name: "Salvar nova senha" }),
    ).toBeEnabled();
  }
});

test("MFA errors identify the code, clear it and permit another attempt", async ({
  page,
}) => {
  await page.route("**/v1/auth/session", (route) =>
    route.fulfill({ json: { stage: "mfa", master: true } }),
  );
  await page.route("**/v1/admin/auth/mfa", (route) =>
    route.fulfill({ status: 401, json: { code: "MFA_INVALID" } }),
  );
  await page.goto("/admin/login");
  const code = page.getByLabel("Código de autenticação ou recuperação");
  await code.fill("123456");
  await page.getByRole("button", { name: "Verificar código" }).click();
  await expect(page.locator("#form-error")).toContainText("Código inválido");
  await expect(code).toHaveValue("");
  await expect(code).toHaveAttribute("aria-describedby", "form-error");
  await expect(
    page.getByRole("button", { name: "Verificar código" }),
  ).toBeEnabled();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("login preserves identifier and safely handles transport and malformed responses", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("E-mail ou usuário").fill("synthetic-user");
  for (const failure of ["network", "html", "rate"] as const) {
    await page.route("**/v1/auth/login", (route) =>
      failure === "network"
        ? route.abort()
        : route.fulfill(
            failure === "html"
              ? {
                  status: 502,
                  contentType: "text/html",
                  body: "internal stack trace",
                }
              : {
                  status: 429,
                  json: { message: "E-mail ou senha inválidos." },
                },
          ),
    );
    await page.getByLabel("Senha", { exact: true }).fill("synthetic-password");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.locator("#form-error")).toContainText(
      failure === "network"
        ? "conectar"
        : failure === "rate"
          ? "Muitas tentativas"
          : "Não foi possível concluir",
    );
    await expect(page.getByLabel("E-mail ou usuário")).toHaveValue(
      "synthetic-user",
    );
    await expect(page.getByLabel("Senha", { exact: true })).toHaveValue("");
  }
});
