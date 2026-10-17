import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const master of [false, true]) {
  test(`${master ? "Master" : "common"}: own sessions, confirmations, focus, revocation and current logout`, async ({
    page,
    request,
    context,
  }, testInfo) => {
    await request.post("http://localhost:18631/reset", { data: { master } });
    await context.addCookies([
      {
        name: "login_session",
        value: "synthetic-session",
        domain: "localhost",
        path: "/",
      },
    ]);
    const base = master ? "/admin/settings" : "/settings";
    await page.goto(base);
    await expect(
      page.getByRole("heading", { name: "Configurações da conta" }),
    ).toBeVisible();
    const navigation = page.getByRole("navigation", {
      name: "Configurações da conta",
    });
    await expect(
      navigation.getByRole("link", { name: "Perfil", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("Usuário", { exact: true })).toBeVisible();
    await navigation
      .getByRole("link", { name: "Sessões", exact: true })
      .click();
    await expect(page).toHaveURL(`${base}?tab=sessions`);
    await expect(
      navigation.getByRole("link", { name: "Sessões", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Este acesso", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Autenticação pendente", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Usuário", { exact: true })).toHaveCount(0);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: testInfo.outputPath(`sessions-${width}.png`),
        fullPage: true,
      });
    }
    const other = page
      .getByRole("button", { name: /Encerrar sessão criada/ })
      .first();
    await other.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("button", { name: "Cancelar" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(other).toBeFocused();
    await other.click();
    const sent = page.waitForRequest("**/auth/sessions/*/revoke");
    await dialog
      .getByRole("button", { name: "Confirmar encerramento" })
      .click();
    expect((await sent).postDataJSON()).toEqual({});
    await expect(
      page.getByText("Sessão encerrada.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Encerrar sessão criada/ }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("heading", { name: "Sessões ativas" }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Encerrar outras sessões", exact: true })
      .click();
    await expect(
      dialog.getByText(/Este acesso continuará ativo/),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Confirmar encerramento" })
      .click();
    await expect(page.getByText("Nenhuma outra sessão ativa.")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Encerrar outras sessões",
        exact: true,
      }),
    ).toBeDisabled();
    await page.reload();
    await expect(page.getByText("Este acesso", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Encerrar sessão atual", exact: true })
      .click();
    await expect(dialog.getByText(/encaminhado ao login/)).toBeVisible();
    await dialog
      .getByRole("button", { name: "Confirmar encerramento" })
      .click();
    await expect(page).toHaveURL(master ? "/admin/login" : "/login");
  });
}

test("session loading, empty response, list retry and mutation failure", async ({
  page,
  request,
  context,
}) => {
  await request.post("http://localhost:18631/reset");
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-session",
      domain: "localhost",
      path: "/",
    },
  ]);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/auth/sessions", async (route) => {
    await gate;
    await route.fulfill({ status: 503, json: {} });
  });
  await page.goto("/settings?tab=sessions");
  await expect(page.getByText("Carregando sessões…")).toBeVisible();
  release();
  await expect(
    page.getByRole("region", { name: "Sessões ativas" }).getByRole("alert"),
  ).toContainText("temporariamente indisponível");
  await page.unroute("**/v1/auth/sessions");
  await page.route("**/v1/auth/sessions", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(
    page.getByText("Nenhuma sessão ativa encontrada."),
  ).toBeVisible();
  await page.unroute("**/v1/auth/sessions");
  await page.getByRole("button", { name: "Atualizar", exact: true }).click();
  await page
    .getByRole("button", { name: "Encerrar outras sessões", exact: true })
    .click();
  await page.route("**/v1/auth/sessions/others/revoke", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Confirmar encerramento" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "temporariamente indisponível",
  );
  await expect(
    dialog.getByRole("button", { name: "Confirmar encerramento" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /Encerrar sessão criada/ }),
  ).toHaveCount(2);
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(
    page.getByRole("button", { name: "Encerrar outras sessões", exact: true }),
  ).toBeFocused();
});
