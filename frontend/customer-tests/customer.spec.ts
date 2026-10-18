import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const profile = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Cliente de teste",
  email: "customer@example.invalid",
  status: "active",
  mfaEnabled: false,
  emailVerifiedAt: "2026-10-18T12:00:00Z",
  createdAt: "2026-10-18T12:00:00Z",
};

test("acceptance removes fragment, posts secret only on confirmation, supports recovery and login MFA", async ({
  page,
}) => {
  const sent: { path: string; data: Record<string, unknown> }[] = [];
  await page.route("**/v1/customer/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    sent.push({ path, data: route.request().postDataJSON() });
    return route.fulfill({
      json: path.endsWith("/login")
        ? { stage: "mfa" }
        : path.endsWith("/request")
          ? {
              message:
                "Se a conta puder recuperar a senha, enviaremos as instruções.",
            }
          : { accepted: true },
    });
  });
  await page.goto("/customer/accept#token=synthetic-secret");
  await expect(page).toHaveURL("/customer/accept");
  expect(sent).toHaveLength(0);
  await page.getByLabel("Nome de exibição").fill("Cliente");
  await page.getByLabel("Nova senha").fill("long fixture password");
  await page.getByLabel("Confirme a senha").fill("long fixture password");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toContainText("Conta ativada");
  expect(sent[0].data.token).toBe("synthetic-secret");
  await page.goto("/customer/reset#token=reset-secret");
  await expect(page).toHaveURL("/customer/reset");
  await page.getByLabel("Nova senha").fill("long replacement password");
  await page.getByLabel("Confirme a senha").fill("long replacement password");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByRole("status")).toContainText(
    "MFA permanece protegido",
  );
  await page.goto("/customer/forgot");
  await page.getByLabel("E-mail").fill("unknown@example.invalid");
  await page.getByRole("button", { name: "Enviar instruções" }).click();
  await expect(page.getByRole("status")).toContainText("Se a conta");
  await page.goto("/customer/login");
  await page.getByLabel("E-mail").fill("customer@example.invalid");
  await page.getByLabel("Senha", { exact: true }).fill("long fixture password");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(
    page.getByLabel("Código do autenticador ou de recuperação"),
  ).toBeVisible();
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("account displays real data, edits name, enrolls MFA and revokes own sessions", async ({
  page,
}, info) => {
  let current = { ...profile };
  let other = true;
  await page.route("**/v1/customer/**", async (route) => {
    const path = new URL(route.request().url()).pathname,
      body =
        route.request().method() === "POST"
          ? route.request().postDataJSON()
          : null;
    let response: object = {};
    if (path.endsWith("/account")) {
      if (body) current = { ...current, name: body.name };
      response = current;
    }
    if (path.endsWith("/sessions"))
      response = {
        items: [
          {
            id: "current",
            current: true,
            stage: "full",
            createdAt: "2026-10-18T12:00:00Z",
            expiresAt: "2026-10-18T20:00:00Z",
          },
          ...(other
            ? [
                {
                  id: "other",
                  current: false,
                  stage: "full",
                  createdAt: "2026-10-18T11:00:00Z",
                  expiresAt: "2026-10-18T19:00:00Z",
                },
              ]
            : []),
        ],
      };
    if (path.endsWith("/revoke")) {
      expect(body).toEqual({ others: true });
      other = false;
    }
    if (path.endsWith("/setup")) response = { secret: "JBSWY3DPEHPK3PXP" };
    if (path.endsWith("/enroll")) {
      current.mfaEnabled = true;
      response = {
        recoveryCodes: ["recovery-fixture-one", "recovery-fixture-two"],
      };
    }
    await route.fulfill({ json: response });
  });
  await page.goto("/customer/account");
  await expect(page.getByText(profile.email)).toBeVisible();
  await page.getByLabel("Nome de exibição").fill("Nome atualizado");
  await page.getByRole("button", { name: "Salvar nome" }).click();
  await expect(page.getByRole("status")).toContainText("Nome atualizado");
  await page.getByLabel("Senha atual").fill("long fixture password");
  await page.getByRole("button", { name: "Configurar MFA" }).click();
  await expect(
    page.getByText("JBSWY3DPEHPK3PXP", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Código do novo autenticador").fill("123456");
  await page.getByRole("button", { name: "Confirmar MFA" }).click();
  await expect(page.getByText("recovery-fixture-one")).toBeVisible();
  await page.getByRole("button", { name: "Guardei os códigos" }).click();
  await expect(page.getByText("recovery-fixture-one")).toHaveCount(0);
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Encerrar outras sessões" }).click();
  await expect(
    page.getByRole("button", { name: "Encerrar outras sessões" }),
  ).toBeDisabled();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`account-${width}.png`),
      fullPage: true,
    });
  }
});

test("organizational customers tab, exact search, invitation, suspension and errors", async ({
  page,
  context,
}, info) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-internal",
      domain: "localhost",
      path: "/",
    },
  ]);
  let failed = false,
    invited = false,
    suspended = false;
  await page.route("**/v1/organization-customers**", async (route) => {
    const url = new URL(route.request().url());
    if (failed) {
      failed = false;
      return route.fulfill({ status: 503, json: { message: "Indisponível" } });
    }
    if (url.pathname.endsWith("/invite")) {
      invited = true;
      return route.fulfill({ json: { queued: true } });
    }
    if (url.pathname.endsWith("/status")) {
      suspended = true;
      return route.fulfill({ json: { status: "suspended" } });
    }
    if (url.pathname.endsWith(profile.id))
      return route.fulfill({ json: { ...profile, invitation: null } });
    return route.fulfill({
      json: {
        items: [{ ...profile, status: suspended ? "suspended" : "active" }],
        total: 1,
      },
    });
  });
  await page.goto(
    "/organizations/11111111-1111-4111-8111-111111111111?tab=customers",
  );
  await expect(
    page.getByRole("heading", { name: "Clientes", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(profile.email)).toBeVisible();
  await page.getByText("Convidar cliente", { exact: true }).click();
  await page.getByLabel("E-mail do cliente").fill("new@example.invalid");
  await page.getByRole("button", { name: "Enviar convite" }).click();
  await expect(page.getByRole("status")).toContainText("Convite enfileirado");
  expect(invited).toBe(true);
  await page.getByRole("button", { name: "Ver detalhes" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Suspender cliente" }).click();
  await expect(page.getByText("Suspenso", { exact: true })).toBeVisible();
  expect(suspended).toBe(true);
  failed = true;
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Indisponível" }),
  ).toContainText("Indisponível");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText(profile.email)).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`customers-${width}.png`),
      fullPage: true,
    });
  }
});
