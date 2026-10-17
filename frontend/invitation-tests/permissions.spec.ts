import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const permissionCatalog = {
  "organization.read": "Visualizar organização",
  "organization.update": "Editar dados da organização",
  "members.read": "Consultar usuários",
  "members.create": "Cadastrar usuários",
  "members.link": "Vincular contas existentes",
  "members.remove": "Remover vínculos",
  "permissions.manage": "Administrar permissões",
};
const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
for (const master of [true, false]) {
  test(`permission matrix, batch editing and responsive layout (${master ? "Master" : "administrator"})`, async ({
    page,
    context,
  }, info) => {
    await context.addCookies([
      {
        name: "login_session",
        value: "synthetic-permissions",
        domain: "localhost",
        path: "/",
      },
    ]);
    let selected: string[] = [];
    let saves = 0;
    let fail = false;
    let release: (() => void) | undefined;
    await page.route(
      `**/v1/${master ? "admin/" : ""}organizations/${id}/permissions`,
      async (route) => {
        if (route.request().method() === "POST") {
          saves++;
          const body = route.request().postDataJSON();
          expect(body.role).toBe("MEMBER");
          if (fail) return route.fulfill({ status: 503, json: {} });
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          selected = body.permissions;
        }
        return route.fulfill({
          json: {
            catalog: permissionCatalog,
            roles: {
              ORGANIZATION_ADMIN: {
                protected: true,
                permissions: Object.keys(permissionCatalog),
              },
              MEMBER: { protected: false, permissions: selected },
            },
          },
        });
      },
    );
    await page.goto(
      `/${master ? "admin/" : ""}organizations/${id}?tab=permissions`,
    );
    const panel = page.getByRole("region", {
      name: "Cargos e permissões",
      exact: true,
    });
    const form = panel.getByRole("form");
    await expect(
      panel.getByText("2 cargos · 7 permissões", { exact: true }),
    ).toBeVisible();
    await expect(form.getByRole("columnheader")).toHaveCount(3);
    await expect(form.getByRole("rowheader")).toHaveCount(7);
    for (const label of Object.values(permissionCatalog)) {
      const fixed = form.getByLabel(
        `Administrador da organização — ${label} — fixa`,
        { exact: true },
      );
      await expect(fixed).toBeChecked();
      await expect(fixed).toBeDisabled();
    }
    const flag = form.getByLabel("Membro — Consultar usuários", {
      exact: true,
    });
    await flag.focus();
    await page.keyboard.press("Space");
    await expect(flag).toBeChecked();
    expect(saves).toBe(0);
    await form.getByRole("button", { name: "Descartar", exact: true }).click();
    await expect(flag).not.toBeChecked();
    await expect(form.getByRole("status")).toHaveText(
      "Alterações descartadas.",
    );
    await flag.check();
    await form
      .getByLabel("Membro — Visualizar organização", { exact: true })
      .check();
    const save = form.getByRole("button", {
      name: "Salvar alterações",
      exact: true,
    });
    await save.click();
    await expect(form.getByRole("status")).toHaveText("Salvando permissões…");
    await expect(flag).toBeDisabled();
    await expect(
      form.getByRole("button", { name: "Salvando…", exact: true }),
    ).toBeDisabled();
    await expect.poll(() => !!release).toBe(true);
    release!();
    await expect(form.getByRole("status")).toHaveText("Permissões salvas.");
    expect(saves).toBe(1);
    expect(selected.sort()).toEqual(["members.read", "organization.read"]);
    await page.reload();
    await expect(flag).toBeChecked();
    await flag.uncheck();
    fail = true;
    await save.click();
    await expect(panel.getByRole("alert")).toBeVisible();
    await expect(flag).not.toBeChecked();
    await expect(save).toBeEnabled();
    await form.getByRole("button", { name: "Descartar", exact: true }).click();
    await expect(flag).toBeChecked();
    await expect(panel.getByRole("alert")).toHaveCount(0);
    for (const width of [947, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      await panel.getByRole("region").evaluate((element) => {
        element.scrollLeft = 0;
      });
      await panel.screenshot({
        path: info.outputPath(`permissions-${width}.png`),
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await panel.getByRole("region").focus();
      await flag.focus();
      await expect(flag).toBeFocused();
      const box = (await flag.boundingBox())!;
      const region = (await panel.getByRole("region").boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(region.x);
      expect(box.x + box.width).toBeLessThanOrEqual(region.x + region.width);
    }
  });
}
test("permission management is unavailable without authorization", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-readonly",
      domain: "localhost",
      path: "/",
    },
  ]);
  let calls = 0;
  await page.route("**/permissions", (route) => {
    calls++;
    return route.fulfill({ status: 403, json: {} });
  });
  await page.goto(`/organizations/${id}?tab=permissions`);
  await expect(
    page.getByRole("link", { name: "Cargos e permissões", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("form", { name: "Permissões do Membro" }),
  ).toHaveCount(0);
  expect(calls).toBe(0);
});
test("permission loading failure exposes retry without editable controls", async ({
  page,
  context,
}) => {
  await context.addCookies([
    {
      name: "login_session",
      value: "synthetic-permissions",
      domain: "localhost",
      path: "/",
    },
  ]);
  let release: (() => void) | undefined;
  let calls = 0;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    "**/v1/organizations/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/permissions",
    async (route) => {
      calls++;
      await blocked;
      return route.fulfill({ status: 403, json: {} });
    },
  );
  await page.goto(`/organizations/${id}?tab=permissions`);
  await expect(page.getByRole("status")).toHaveText("Carregando permissões…");
  await expect.poll(() => !!release).toBe(true);
  release!();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tentar novamente" }),
  ).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect.poll(() => calls).toBeGreaterThan(1);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});
