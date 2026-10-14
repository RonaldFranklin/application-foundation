import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const token = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa." + "a".repeat(43);
const preview = {
  organization: "Organização de teste",
  role: "MEMBER",
  expiresAt: "2030-01-01T00:00:00.000Z",
};
test("new account: fragment removed, preview never accepts, keyboard validation and success", async ({
  page,
}) => {
  let accepts = 0;
  await page.route("**/v1/invitations/preview", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({ json: preview });
  });
  await page.route("**/v1/invitations/accept", async (route) => {
    accepts++;
    expect(route.request().postDataJSON().mode).toBe("new");
    await route.fulfill({ json: { accepted: true } });
  });
  const response = await page.goto(`/invitations/accept#token=${token}`);
  expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
  await expect(
    page.getByText("Organização de teste", { exact: true }),
  ).toBeVisible();
  expect(page.url()).not.toContain(token);
  expect(accepts).toBe(0);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await page.getByLabel("Como deseja continuar?").selectOption("new");
  await page.getByLabel("Usuário", { exact: true }).fill("nova-pessoa");
  await page
    .getByLabel("Senha", { exact: true })
    .fill("synthetic new password");
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("synthetic other password");
  await page
    .getByRole("button", { name: "Aceitar convite", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "As senhas devem coincidir.",
  );
  await expect(page.getByRole("main").getByRole("alert")).toBeFocused();
  expect(accepts).toBe(0);
  await page
    .getByLabel("Confirmar senha", { exact: true })
    .fill("synthetic new password");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page
    .getByRole("button", { name: "Aceitar convite", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Convite aceito");
  await expect(page.getByRole("status")).toBeFocused();
  expect(accepts).toBe(1);
  await expect(
    page.getByRole("link", { name: "Entrar", exact: true }),
  ).toHaveAttribute("href", "/login");
});
test("existing account: normal login in separate tab, safe failure, retry and explicit acceptance", async ({
  page,
}) => {
  await page.route("**/v1/invitations/preview", (route) =>
    route.fulfill({ json: preview }),
  );
  let attempts = 0;
  await page.route("**/v1/invitations/accept", (route) => {
    expect(route.request().postDataJSON()).toEqual({ token, mode: "existing" });
    return route.fulfill(
      ++attempts === 1
        ? {
            status: 401,
            json: {
              code: "SESSION_REQUIRED",
              message: "private internal error",
            },
          }
        : { json: { accepted: true } },
    );
  });
  await page.goto(`/invitations/accept#token=${token}`);
  const login = page.getByRole("link", {
    name: "Entrar na conta em outra aba",
  });
  await expect(login).toHaveAttribute("target", "_blank");
  await expect(login).toHaveAttribute("href", "/login");
  await page
    .getByRole("button", { name: "Aceitar convite", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Entre na conta correspondente",
  );
  await expect(page.getByText("private internal error")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Aceitar convite", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Convite aceito");
});
for (const [code, text] of [
  ["INVITATION_EXPIRED", "expirou"],
  ["INVITATION_REVOKED", "cancelado"],
  ["INVITATION_USED", "já foi aceito"],
  ["INVITATION_INVALID", "inválido ou substituído"],
]) {
  test(`public state ${code}`, async ({ page }) => {
    await page.route("**/v1/invitations/preview", (route) =>
      route.fulfill({ status: 400, json: { code } }),
    );
    await page.goto(`/invitations/accept#token=${token}`);
    await expect(page.getByRole("main").getByRole("alert")).toContainText(text);
    await expect(
      page.getByRole("button", { name: "Aceitar convite", exact: true }),
    ).toHaveCount(0);
  });
}
