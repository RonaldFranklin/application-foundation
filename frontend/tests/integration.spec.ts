import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { createHmac, randomBytes } from "node:crypto";
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = createHmac("sha1", key).update(time).digest();
  const offset = h[19] & 15;
  return ((h.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}
async function checkTemporaryPassword(
  masterPage: Page,
  username: string,
  temporary: string,
) {
  const context = await masterPage.context().browser()!.newContext();
  const page = await context.newPage();
  const origin = new URL(masterPage.url()).origin;
  try {
    await page.goto(`${origin}/login`);
    await page.getByLabel("E-mail ou usuário").fill(username);
    await page.getByLabel("Senha", { exact: true }).fill(temporary);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Uma senha só sua.",
    );
    for (const path of ["/", "/settings", "/admin", "/admin/organizations"]) {
      await page.goto(origin + path);
      await expect(page).toHaveURL(
        path.startsWith("/admin") ? /\/admin\/login$/ : /\/login$/,
      );
    }
    await page.goto(`${origin}/login`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Uma senha só sua.",
    );
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    }
    await page.getByLabel("Nova senha", { exact: true }).fill(temporary);
    await page
      .getByLabel("Confirmar nova senha", { exact: true })
      .fill(temporary);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.locator("#form-error")).toHaveText(
      "A nova senha deve ser diferente da senha atual.",
    );
    await expect(page.getByLabel("Nova senha", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.getByLabel("Confirmar nova senha", { exact: true }),
    ).toHaveValue("");
    const password = randomBytes(24).toString("hex");
    await page.getByLabel("Nova senha", { exact: true }).fill(password);
    await page
      .getByLabel("Confirmar nova senha", { exact: true })
      .fill("different password");
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page.locator("form").getByRole("alert").last()).toContainText(
      "confirmação",
    );
    await expect(page.getByLabel("Nova senha", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      page.getByLabel("Confirmar nova senha", { exact: true }),
    ).toHaveValue("");
    await page.getByLabel("Nova senha", { exact: true }).fill(password);
    await page
      .getByLabel("Confirmar nova senha", { exact: true })
      .fill(password);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page).toHaveURL(`${origin}/`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Boas-vindas ao Application Foundation",
    );
    await page.goto(`${origin}/settings`);
    await expect(page.locator("dd").first()).toHaveText(username);
    await page.goto(`${origin}/admin/organizations`);
    await expect(page).toHaveURL(/\/admin\/login$/);
  } finally {
    await context.close();
  }
}
async function checkOrganizationPermissions(
  masterPage: Page,
  temporary: string,
) {
  const organizationPath = new URL(masterPage.url()).pathname.replace(
    "/admin",
    "",
  );
  const adminContext = await masterPage.context().browser()!.newContext();
  const memberContext = await masterPage.context().browser()!.newContext();
  const admin = await adminContext.newPage();
  const member = await memberContext.newPage();
  const origin = new URL(masterPage.url()).origin;
  async function initialLogin(page: Page, username: string, password: string) {
    await page.goto(`${origin}/login`);
    await page.getByLabel("E-mail ou usuário").fill(username);
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    const next = randomBytes(24).toString("hex");
    await page.getByLabel("Nova senha", { exact: true }).fill(next);
    await page.getByLabel("Confirmar nova senha", { exact: true }).fill(next);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await expect(page).toHaveURL(`${origin}/`);
  }
  try {
    await initialLogin(admin, "admin-browser", temporary);
    await admin
      .getByRole("link", { name: "Organizações", exact: true })
      .click();
    await admin
      .getByRole("link", { name: "Organização editada", exact: true })
      .click();
    await admin
      .getByRole("link", { name: "Cargos e permissões", exact: true })
      .click();
    const settings = admin.getByRole("form", { name: "Permissões do Membro" });
    await expect(settings.getByRole("checkbox")).toHaveCount(8);
    for (const checkbox of await settings.getByRole("checkbox").all())
      await expect(checkbox).not.toBeChecked();
    await expect(admin.getByText(/Acesso geral protegido/)).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await admin.setViewportSize({ width, height: 900 });
      expect(
        await admin.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        (await new AxeBuilder({ page: admin }).analyze()).violations,
      ).toEqual([]);
      await admin.screenshot({
        path: `/tmp/organization-permissions-${width}.png`,
        fullPage: true,
      });
    }
    await admin.getByRole("link", { name: "Usuários", exact: true }).click();
    await admin
      .getByRole("button", { name: "Adicionar usuário", exact: true })
      .click();
    await admin
      .getByRole("button", { name: "Cadastrar usuário", exact: true })
      .click();
    await admin.getByLabel("Usuário", { exact: true }).fill("scoped-browser");
    await admin
      .getByLabel("E-mail", { exact: true })
      .fill("scoped-browser@example.invalid");
    const memberTemporary = randomBytes(24).toString("hex");
    await admin
      .getByLabel("Senha temporária", { exact: true })
      .fill(memberTemporary);
    await admin
      .locator("form")
      .getByRole("button", { name: "Adicionar usuário", exact: true })
      .click();
    await expect(
      admin.getByRole("rowheader", { name: "scoped-browser" }),
    ).toBeVisible();
    for (let i = 0; i < 4; i++) {
      const response = await admin.request.post(
        `${process.env.PUBLIC_API_ORIGIN}/v1${organizationPath}/members`,
        {
          headers: { Origin: origin },
          data: {
            mode: "new",
            username: `paged-${i}`,
            email: `paged-${i}@example.invalid`,
            password: memberTemporary,
          },
        },
      );
      expect(response.status()).toBe(200);
    }
    await admin.reload();
    await admin.getByLabel("Itens por página").selectOption("5");
    await expect(admin.locator("tbody tr")).toHaveCount(5);
    await admin
      .getByRole("navigation", { name: "Paginação de usuários" })
      .getByRole("button", { name: "Próxima" })
      .click();
    await expect(admin.locator("tbody tr")).toHaveCount(2);
    await admin
      .getByRole("navigation", { name: "Paginação de usuários" })
      .getByRole("button", { name: "Anterior" })
      .click();
    await expect(admin.locator("tbody tr")).toHaveCount(5);
    await initialLogin(member, "scoped-browser", memberTemporary);
    await expect(
      member
        .getByRole("navigation", { name: "Navegação principal" })
        .getByRole("link", { name: "Organizações" }),
    ).toHaveCount(0);
    await member.goto(origin + organizationPath + "?tab=users");
    await expect(member).toHaveURL(`${origin}/`);
    await admin
      .getByRole("link", { name: "Cargos e permissões", exact: true })
      .click();
    await settings
      .getByLabel("Visualizar organização", { exact: true })
      .check();
    await settings.getByLabel("Consultar usuários", { exact: true }).check();
    await settings.getByRole("button", { name: "Salvar permissões" }).click();
    await expect(settings.getByRole("status")).toHaveText("Permissões salvas.");
    await admin.reload();
    await expect(
      settings.getByLabel("Consultar usuários", { exact: true }),
    ).toBeChecked();
    await member.reload();
    await member
      .getByRole("link", { name: "Organizações", exact: true })
      .click();
    await member
      .getByRole("link", { name: "Organização editada", exact: true })
      .click();
    await member.getByRole("link", { name: "Usuários", exact: true }).click();
    await expect(
      member.getByRole("rowheader", { name: "scoped-browser" }),
    ).toBeVisible();
    await expect(
      member.getByRole("button", { name: "Adicionar usuário", exact: true }),
    ).toHaveCount(0);
    await expect(member.getByRole("button", { name: /Ações de/ })).toHaveCount(
      0,
    );
    await member.getByLabel("Buscar usuários").fill("scoped");
    await expect(member.locator("tbody tr")).toHaveCount(1);
    await member
      .getByLabel("Filtrar por cargo")
      .selectOption("ORGANIZATION_ADMIN");
    await expect(
      member.getByText("Nenhum usuário encontrado para os filtros."),
    ).toBeVisible();
    await member.goto(origin + organizationPath + "?tab=permissions");
    await expect(member).toHaveURL(`${origin}/`);
    await settings
      .getByLabel("Visualizar organização", { exact: true })
      .uncheck();
    await settings.getByLabel("Consultar usuários", { exact: true }).uncheck();
    await settings.getByRole("button", { name: "Salvar permissões" }).click();
    await expect(settings.getByRole("status")).toHaveText("Permissões salvas.");
    await member.goto(origin + organizationPath + "?tab=users");
    await expect(member).toHaveURL(`${origin}/`);
    await member.getByRole("button", { name: /Menu da conta/ }).click();
    await member.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(member).toHaveURL(/\/login$/);
  } finally {
    await adminContext.close();
    await memberContext.close();
  }
}
async function checkMembers(page: Page) {
  await page.getByRole("link", { name: "Usuários", exact: true }).click();
  await expect(page).toHaveURL(/\?tab=users$/);
  await expect(
    page.getByRole("heading", { name: "Usuários da organização" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Informações da organização" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Usuários", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Visão geral", exact: true }).click();
  await expect(page).toHaveURL(/\?tab=overview$/);
  await expect(
    page.getByRole("heading", { name: "Informações da organização" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Usuários da organização" }),
  ).toHaveCount(0);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Usuários da organização" }),
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "Informações da organização" }),
  ).toBeVisible();
  await page.goBack();

  await expect(
    page.getByText("Nenhum usuário vinculado à organização."),
  ).toBeVisible();
  const create = page.getByRole("button", {
    name: "Cadastrar usuário",
    exact: true,
  });
  const add = page.getByRole("button", {
    name: "Adicionar usuário",
    exact: true,
  });
  await add.focus();
  await page.keyboard.press("Enter");
  await expect(add).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(add).toBeFocused();
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(create).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Usuário", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect(add).toBeFocused();
  let administratorTemporary = "";
  for (const [username, role] of [
    ["member-browser", "MEMBER"],
    ["admin-browser", "ORGANIZATION_ADMIN"],
  ]) {
    await add.click();
    await create.click();
    await page.getByLabel("Usuário", { exact: true }).fill(username);
    await page
      .getByLabel("E-mail", { exact: true })
      .fill(`${username}@example.invalid`);
    const temporary = randomBytes(24).toString("hex");
    if (username === "admin-browser") administratorTemporary = temporary;
    await page.getByLabel("Senha temporária", { exact: true }).fill(temporary);
    await page
      .getByRole("combobox", { name: "Papel na organização", exact: true })
      .selectOption(role);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page
      .locator("form")
      .getByRole("button", { name: "Adicionar usuário", exact: true })
      .click();
    await expect(
      page.getByRole("rowheader", {
        name: `${username} ${username}@example.invalid`,
        exact: true,
      }),
    ).toBeVisible();
    if (username === "member-browser")
      await checkTemporaryPassword(page, username, temporary);
  }
  await checkOrganizationPermissions(page, administratorTemporary);
  const memberRow = page.getByRole("row").filter({
    has: page.getByRole("rowheader", {
      name: "member-browser member-browser@example.invalid",
      exact: true,
    }),
  });
  await expect(memberRow).toContainText("Membro");
  await page
    .getByRole("button", { name: "Ações de member-browser", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Alterar papel de member-browser",
      exact: true,
    })
    .click();
  await page
    .getByRole("combobox", { name: "Papel na organização", exact: true })
    .selectOption("ORGANIZATION_ADMIN");
  await page.getByRole("button", { name: "Salvar papel", exact: true }).click();
  await expect(memberRow).toContainText("Administrador da organização");
  await add.click();
  await page
    .getByRole("button", { name: "Vincular conta existente", exact: true })
    .click();
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("member-browser@example.invalid");
  await page
    .locator("form")
    .getByRole("button", { name: "Adicionar usuário", exact: true })
    .click();
  await expect(
    page
      .getByRole("region", { name: "Usuários da organização", exact: true })
      .getByRole("alert"),
  ).toContainText("já pertence");
  await page.getByRole("button", { name: "Cancelar", exact: true }).click();
  await page.reload();
  await expect(memberRow).toContainText("Administrador da organização");
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/login-members-${width}.png`,
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "Ações de member-browser", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Remover vínculo de member-browser",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Confirmar remoção", exact: true })
    .click();
  await expect(memberRow).toHaveCount(0);
  await add.click();
  await page
    .getByRole("button", { name: "Vincular conta existente", exact: true })
    .click();
  await page
    .getByLabel("E-mail", { exact: true })
    .fill("member-browser@example.invalid");
  await page
    .locator("form")
    .getByRole("button", { name: "Adicionar usuário", exact: true })
    .click();
  await expect(memberRow).toContainText("Membro");
}
async function checkHomeAndOpenSettings(page: Page, master: boolean) {
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Boas-vindas ao Application Foundation",
  );
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(
    nav.getByRole("link", { name: "Início", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Organizações" })).toHaveCount(
    master ? 1 : 0,
  );
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: `/tmp/login-home-${master ? "master" : "common"}-${width}.png`,
      fullPage: true,
    });
  }
  if (master) {
    await nav.getByRole("link", { name: "Organizações" }).click();
    await expect(page).toHaveURL(/\/admin\/organizations$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Organizações",
    );
    await expect(
      page.getByText("Nenhuma organização encontrada"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Adicionar organização" }).click();
    await page
      .getByLabel("Nome da organização", { exact: true })
      .fill("Organização de teste");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "Ativa", exact: true }),
    ).toBeVisible();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      const table = page
        .getByRole("region", { name: "Tabela de organizações" })
        .locator("table");
      expect(
        await table.evaluate((element) => {
          const rows = element.querySelectorAll("tr");
          return [...rows[0].children].every((cell, index) => {
            const header = cell.getBoundingClientRect();
            const body = rows[1].children[index].getBoundingClientRect();
            return (
              Math.abs(header.x - body.x) < 1 &&
              Math.abs(header.width - body.width) < 1
            );
          });
        }),
      ).toBe(true);
      await page.getByRole("cell", { name: "Ativa", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/organizations$/);
      await page.screenshot({
        path: `/tmp/login-organizations-${width}.png`,
        fullPage: true,
      });
    }
    const actions = page.getByRole("button", {
      name: "Ações de Organização de teste",
    });
    await actions.focus();
    await page.keyboard.press("Enter");
    await expect(actions).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(actions).toBeFocused();
    await expect(actions).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "Abrir", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(actions).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByLabel("Nome da organização", { exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await expect(actions).toBeFocused();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await actions.click();
      const panel = page.locator("[popover]:popover-open");
      await expect(panel).toBeVisible();
      const bounds = await panel.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press("Tab");
      expect(
        await page
          .getByRole("link", { name: "Abrir", exact: true })
          .evaluate((element) => getComputedStyle(element).outlineStyle),
      ).toBe("solid");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `/tmp/organization-menu-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("heading", { name: "Organizações", exact: true })
        .click();
      await expect(actions).toHaveAttribute("aria-expanded", "false");
    }
    await actions.click();
    await page.getByRole("button", { name: "Desativar", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "Inativa", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Status", exact: true })
      .selectOption("active");
    await expect(
      page.getByText("Nenhuma organização encontrada"),
    ).toBeVisible();
    await page
      .getByRole("combobox", { name: "Status", exact: true })
      .selectOption("inactive");
    await actions.click();
    await expect(
      page.getByRole("link", { name: "Abrir", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("link", { name: "Organização de teste", exact: true })
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Organização de teste",
    );
    await expect(
      page.getByRole("heading", { name: "Informações da organização" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Editar", exact: true }).click();
    await page
      .getByLabel("Nome da organização", { exact: true })
      .fill("Organização editada");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Organização editada",
    );
    await page.getByRole("button", { name: "Ativar", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Desativar", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Organização editada",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await checkMembers(page);
    await page
      .getByRole("navigation", { name: "Caminho da organização" })
      .getByRole("link", { name: "Organizações" })
      .click();
    await page.getByLabel("Buscar por nome").fill("inexistente");
    await expect(
      page.getByText("Nenhuma organização encontrada"),
    ).toBeVisible();
    await page.getByLabel("Buscar por nome").fill("editada");
    await expect(
      page.getByRole("rowheader", { name: "Organização editada" }),
    ).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Organizações" }),
    ).toHaveAttribute("aria-current", "page");
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await nav.getByRole("link", { name: "Início", exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Boas-vindas ao Application Foundation",
    );
  } else {
    await page.goto("/admin/organizations");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/admin/settings");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await page.goto("/");
  }
  await page.waitForLoadState("load");
  const toggle = page.getByRole("button", { name: /Menu da conta/ });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Configurações da conta" }),
  ).toBeFocused();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(master ? /\/admin\/settings$/ : /\/settings$/);
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
}
test.describe("live API + PostgreSQL", () => {
  test.skip(
    !process.env.LOGIN_INTEGRATION,
    "Run infra/scripts/test-browser.py to supply isolated backend and synthetic credentials.",
  );
  test("ordinary browser login, SSR welcome and logout revoke access", async ({
    page,
    baseURL,
  }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail ou usuário").fill("fixture-user");
    await page
      .getByLabel("Senha", { exact: true })
      .fill(process.env.FIXTURE_USER_PASSWORD!);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(new URL("/", baseURL!).href);
    await checkHomeAndOpenSettings(page, false);
    await expect(page.locator("dd")).toContainText([
      "fixture-user",
      "user@example.invalid",
      "Comum",
      "Configurado: NãoVerificado: Não",
    ]);
    await page.reload();
    await expect(page.locator("dd")).toContainText([
      "fixture-user",
      "user@example.invalid",
      "Comum",
      "Configurado: NãoVerificado: Não",
    ]);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Account Settings",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Configurações da conta" })
        .getByRole("link", { name: "Profile" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator("input, textarea, select")).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "Configurações da conta" })
        .getByRole("link"),
    ).toHaveCount(1);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `/tmp/login-profile-${page.url().endsWith("/admin") ? "master" : "common"}-${width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Editar informações" }).click();
    await page.getByLabel("Usuário", { exact: true }).fill("cancelled");
    await page.getByRole("button", { name: "Cancelar", exact: true }).click();
    await page.getByRole("button", { name: "Editar informações" }).click();
    await expect(page.getByLabel("Usuário", { exact: true })).toHaveValue(
      "fixture-user",
    );
    await page.getByLabel("Usuário", { exact: true }).fill("edited-user");
    await page
      .getByLabel("E-mail", { exact: true })
      .fill("edited@example.invalid");
    await page.getByLabel("Senha atual", { exact: true }).fill("wrong");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.locator("form").getByRole("alert").last()).toContainText(
      "Não foi possível confirmar sua senha atual.",
    );
    await expect(page.getByLabel("Usuário", { exact: true })).toHaveValue(
      "edited-user",
    );
    await expect(page.getByLabel("E-mail", { exact: true })).toHaveValue(
      "edited@example.invalid",
    );
    await expect(page.getByLabel("Senha atual", { exact: true })).toHaveValue(
      "",
    );
    await page
      .getByLabel("Senha atual", { exact: true })
      .fill(process.env.FIXTURE_USER_PASSWORD!);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Informações atualizadas.",
    );
    await expect(page.locator("dd").first()).toHaveText("edited-user");
    await page.reload();
    await expect(page.locator("dd").nth(1)).toHaveText(
      "edited@example.invalid",
    );
    await page
      .getByRole("button", { name: "Alterar senha", exact: true })
      .click();
    const changedPassword = randomBytes(24).toString("hex");
    await page.getByLabel("Nova senha", { exact: true }).fill(changedPassword);
    await page
      .getByLabel("Confirmar nova senha", { exact: true })
      .fill("mismatch");
    await page
      .getByLabel("Senha atual", { exact: true })
      .fill(process.env.FIXTURE_USER_PASSWORD!);
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page.locator("form").getByRole("alert").last()).toContainText(
      "confirmação",
    );
    await page
      .getByLabel("Confirmar nova senha", { exact: true })
      .fill(changedPassword);
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("E-mail ou usuário").fill("edited@example.invalid");
    await page.getByLabel("Senha", { exact: true }).fill(changedPassword);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page).toHaveURL(new URL("/", baseURL!).href);
    await page.getByRole("button", { name: /Menu da conta/ }).click();
    await page.getByRole("button", { name: "Sair", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
  test("master full first access, cookie rotation, recovery login and server protection", async ({
    page,
    context,
    baseURL,
  }) => {
    test.setTimeout(180000);
    await page.goto("/admin/login");
    await page.getByLabel("E-mail ou usuário").fill("fixture-master");
    await page
      .getByLabel("Senha", { exact: true })
      .fill(process.env.FIXTURE_MASTER_PASSWORD!);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Uma senha só sua.",
    );
    // Password-only sessions cannot reach any authenticated master page.
    for (const path of ["/admin", "/admin/settings", "/admin/organizations"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login$/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Uma senha só sua.",
      );
    }
    const before = (await context.cookies()).find(
      (c) => c.name === "login_session",
    )!.value;
    const password = randomBytes(24).toString("hex");
    await page.getByLabel("Nova senha").fill(password);
    await page.getByRole("button", { name: "Salvar nova senha" }).click();
    await page
      .getByRole("button", { name: "Exibir chave de configuração" })
      .click();
    const secret = await page.getByLabel("Chave de configuração").inputValue();
    await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar código" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Guarde seus códigos.",
    );
    const recovery = await page
      .locator(".recovery-codes code")
      .first()
      .innerText();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Concluir e continuar" }).click();
    await expect(page).toHaveURL(new URL("/admin", baseURL!).href);
    await checkHomeAndOpenSettings(page, true);
    await expect(page.locator("dd")).toContainText([
      "fixture-master",
      "master@example.invalid",
      "Master",
      "Configurado: SimVerificado: Sim",
    ]);
    const after = (await context.cookies()).find(
      (c) => c.name === "login_session",
    )!;
    expect(after.value).not.toBe(before);
    expect(after.httpOnly).toBe(true);
    expect(after.sameSite).toBe("Lax");
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Account Settings",
    );
    await expect(
      page
        .getByRole("navigation", { name: "Configurações da conta" })
        .getByRole("link", { name: "Profile" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.locator("input, textarea, select")).toHaveCount(0);
    await expect(
      page
        .getByRole("navigation", { name: "Configurações da conta" })
        .getByRole("link"),
    ).toHaveCount(1);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({
        path: `/tmp/login-profile-${page.url().endsWith("/admin") ? "master" : "common"}-${width}.png`,
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Sair da conta" }).click();
    await page.getByLabel("E-mail ou usuário").fill("fixture-master");
    await page.getByLabel("Senha", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Confirme que é você.",
    );
    await page
      .getByLabel("Código de autenticação ou recuperação")
      .fill(recovery);
    await page.getByRole("button", { name: "Verificar código" }).click();
    await expect(page).toHaveURL(new URL("/admin", baseURL!).href);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/admin");
    expect(
      (await context.cookies()).some((c) => c.name === "login_master_device"),
    ).toBe(true);
    await page.getByRole("button", { name: /Menu da conta/ }).click();
    await page
      .getByRole("button", { name: "Sair e esquecer este dispositivo" })
      .click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    expect(
      (await context.cookies()).some((c) => c.name === "login_master_device"),
    ).toBe(false);
  });
});
