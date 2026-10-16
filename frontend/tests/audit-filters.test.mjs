import { test } from "node:test";
import assert from "node:assert/strict";
import { localMinute } from "../src/features/audit/filters.ts";

test("local minute boundaries preserve timezone and include final seconds", () => {
  process.env.TZ = "America/Sao_Paulo";
  assert.equal(localMinute("2026-01-02T09:00"), "2026-01-02T12:00:00.000Z");
  assert.equal(
    localMinute("2026-01-02T09:00", true),
    "2026-01-02T12:00:59.999Z",
  );
  assert.equal(localMinute(""), "");
  assert.throws(() => localMinute("2026-02-30T12:00"), /válidos/);
  assert.throws(() => localMinute("2026-01-02T12:00Z"), /válidos/);
  process.env.TZ = "America/New_York";
  assert.throws(() => localMinute("2026-03-08T02:30"), /horário local/);
  assert.equal(localMinute("2026-03-08T03:30"), "2026-03-08T07:30:00.000Z");
});
