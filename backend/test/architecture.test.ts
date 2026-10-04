import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import ts from "typescript";
const root = resolve("src");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(resolve(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [resolve(dir, entry.name)]
        : [],
  );
}

test("layer boundaries exclude ORM/HTTP from application and keep controllers free of operation validation", () => {
  const sources = files(root),
    graph = new Map<string, string[]>();
  for (const path of sources) {
    const name = relative(root, path),
      text = readFileSync(path, "utf8");
    const source = ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      true,
    );
    const dependencies: string[] = [];
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      )
        continue;
      const imported = statement.moduleSpecifier.text;
      if (name.startsWith("application/") || name.startsWith("domain/")) {
        if (imported.startsWith(".")) {
          const target = relative(root, resolve(dirname(path), imported));
          assert.match(
            target,
            /^(application|domain)\//,
            `${name} imports ${target}`,
          );
        } else assert.equal(imported, "zod", `${name} imports ${imported}`);
      }
      if (imported.startsWith("@prisma/"))
        assert.ok(name.startsWith("infra/database/"), name);
      if (name.startsWith("presentation/http/controllers/"))
        assert.doesNotMatch(
          imported,
          /infra\/|ports\/repositories|validators\/|@prisma\//,
        );
      if (name.startsWith("infra/database/repositories/"))
        assert.doesNotMatch(
          imported,
          /application\/auth\/(use-cases|validators)/,
        );
      if (imported.startsWith(".")) {
        const target = resolve(dirname(path), imported + ".ts");
        assert.ok(
          sources.includes(target),
          `Unresolved import ${name}: ${imported}`,
        );
        dependencies.push(target);
      }
    }
    if (
      /^(application|domain)\//.test(name) ||
      name.startsWith("infra/database/") ||
      name.startsWith("presentation/http/controllers/")
    ) {
      function visit(node: ts.Node) {
        assert.notEqual(
          node.kind,
          ts.SyntaxKind.AnyKeyword,
          `${name} introduces any`,
        );
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    if (name.startsWith("presentation/http/controllers/"))
      assert.doesNotMatch(
        text,
        /safeParse|\$transaction|\.findUnique|\.cookie\(|res\.status|console\./,
      );
    if (name.startsWith("infra/database/repositories/"))
      assert.doesNotMatch(
        text,
        /ACCOUNT_FAILURE_LIMIT|TURNSTILE_THRESHOLD|COOLDOWN|master-risk|master-anonymous/,
      );
    graph.set(path, dependencies);
  }
  const visited = new Set<string>();
  function visit(path: string, ancestors: Set<string>) {
    assert.equal(
      ancestors.has(path),
      false,
      `Circular dependency: ${relative(root, path)}`,
    );
    if (visited.has(path)) return;
    const next = new Set(ancestors).add(path);
    for (const dependency of graph.get(path) ?? []) visit(dependency, next);
    visited.add(path);
  }
  for (const path of sources) visit(path, new Set());
});
