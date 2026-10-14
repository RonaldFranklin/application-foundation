import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const api = "http://localhost:18731/v1/admin/organizations";
async function post(page: Page, path: string, data: object) {
  const response = await page.request.post(api + path, {
    data,
    headers: { Origin: "http://localhost:18730" },
  });
  expect(response.status()).toBe(200);
  return response.json();
}
test.beforeEach(async ({ context }) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "organization-browser-master",
      domain: "localhost",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
});

test("organization confirmation, errors, filters, restoration, keyboard and responsive accessibility", async ({
  page,
}) => {
  const org = await post(page, "", { name: "Organização restaurável" });
  await page.goto("/admin/organizations");
  const trigger = page.getByRole("button", { name: `Ações de ${org.name}` });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  const confirmation = page.getByRole("form", { name: "Excluir organização" });
  await expect(
    confirmation.getByRole("button", { name: "Cancelar" }),
  ).toBeFocused();
  await confirmation.getByRole("button", { name: "Cancelar" }).click();
  await expect(trigger).toBeFocused();
  await expect(
    page.getByRole("link", { name: org.name, exact: true }),
  ).toBeVisible();
  await trigger.click();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page.route(`**/organizations/${org.id}/remove`, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "private infrastructure detail" }),
    }),
  );
  await confirmation
    .getByRole("button", { name: "Confirmar exclusão" })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Serviço temporariamente indisponível" }),
  ).toBeVisible();
  await expect(page.getByText("private infrastructure detail")).toHaveCount(0);
  await page.unroute(`**/organizations/${org.id}/remove`);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/organizations/${org.id}/remove`, async (route) => {
    await hold;
    await route.continue();
  });
  await confirmation
    .getByRole("button", { name: "Confirmar exclusão" })
    .click();
  await expect(
    confirmation.getByRole("button", { name: "Salvando…" }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole("status").filter({ hasText: /excluída|restaurada|Vínculo/ }),
  ).toContainText("Organização excluída.");
  await expect(
    page.getByRole("link", { name: org.name, exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("Visualização de organizações").selectOption("true");
  await expect(
    page.getByRole("row", { name: /Organização restaurável/ }),
  ).toBeVisible();
  await trigger.click();
  await page.getByRole("button", { name: "Restaurar", exact: true }).click();
  const restore = page.getByRole("form", { name: "Restaurar organização" });
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await restore.getByRole("button", { name: "Confirmar restauração" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /excluída|restaurada|Vínculo/ }),
  ).toContainText("Organização restaurada e ativada.");
  await page.getByLabel("Visualização de organizações").selectOption("false");
  await page.getByRole("link", { name: org.name, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: org.name, exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar exclusão" }).click();
  await expect(page).toHaveURL(/\/admin\/organizations\?deleted=true$/);
  await expect(page.getByLabel("Visualização de organizações")).toHaveValue(
    "true",
  );
  await expect(
    page.getByRole("row", { name: /Organização restaurável/ }),
  ).toBeVisible();
});

test("membership removal/restoration keeps role, supports filters and safe retry", async ({
  page,
}) => {
  const org = await post(page, "", { name: "Organização de vínculos" });
  await post(page, `/${org.id}/members`, {
    mode: "new",
    username: "admin-preservado",
    email: "admin-preservado@example.invalid",
    password: "synthetic browser password",
    role: "ORGANIZATION_ADMIN",
  });
  await post(page, `/${org.id}/members`, {
    mode: "new",
    username: "usuario-restauravel",
    email: "usuario-restauravel@example.invalid",
    password: "synthetic browser password",
    role: "ORGANIZATION_ADMIN",
  });
  const list = await (
    await page.request.get(`${api}/${org.id}/members`)
  ).json();
  const person = list.items.find(
    (m: { username: string }) => m.username === "usuario-restauravel",
  );
  await page.goto(`/admin/organizations/${org.id}?tab=users`);
  const trigger = page.getByRole("button", {
    name: "Ações de usuario-restauravel",
  });
  await trigger.click();
  await page
    .getByRole("button", { name: "Remover vínculo de usuario-restauravel" })
    .click();
  await page
    .getByRole("form", { name: "Remover vínculo", exact: true })
    .getByRole("button", { name: "Cancelar" })
    .click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByRole("button", { name: "Remover vínculo de usuario-restauravel" })
    .click();
  await page.getByRole("button", { name: "Confirmar remoção" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /excluída|restaurada|Vínculo/ }),
  ).toContainText("Vínculo removido");
  await expect(trigger).toHaveCount(0);
  await page.getByLabel("Visualização de vínculos").selectOption("true");
  await page.getByLabel("Filtrar por cargo").selectOption("ORGANIZATION_ADMIN");
  await page.getByLabel("Buscar usuários").fill("usuario-restauravel");
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page
    .getByRole("button", { name: "Restaurar vínculo de usuario-restauravel" })
    .click();
  const restore = page.getByRole("form", {
    name: "Restaurar vínculo",
    exact: true,
  });
  await expect(restore).toContainText("Administrador da organização");
  await page.route(`**/members/${person.userId}/restore`, (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await restore.getByRole("button", { name: "Confirmar restauração" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Serviço temporariamente indisponível" }),
  ).toBeVisible();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.unroute(`**/members/${person.userId}/restore`);
  await restore.getByRole("button", { name: "Confirmar restauração" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /excluída|restaurada|Vínculo/ }),
  ).toContainText("Vínculo restaurado com o papel anterior.");
  await page.getByLabel("Visualização de vínculos").selectOption("false");
  await expect(
    page.getByRole("row", { name: /usuario-restauravel/ }),
  ).toContainText("Administrador da organização");
  await page.reload();
  await expect(
    page.getByRole("row", { name: /usuario-restauravel/ }),
  ).toContainText("Administrador da organização");
});
