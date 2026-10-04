import { test } from "node:test";
import assert from "node:assert/strict";
import {
  publicApiOrigin,
  sessionCookieName,
} from "../src/lib/public-config.ts";
test("HTTP development and HTTPS production derive the backend cookie contract from public origin", () => {
  for (const [origin, name] of [
    ["http://localhost:3001", "login_session"],
    ["https://login.example.invalid", "__Host-login_session"],
  ])
    assert.equal(
      sessionCookieName(publicApiOrigin({ PUBLIC_API_ORIGIN: origin }, origin)),
      name,
    );
});
test("reject build/runtime mismatch, competing legacy flag and invalid origins with clear sanitized messages", () => {
  assert.throws(
    () =>
      publicApiOrigin(
        { PUBLIC_API_ORIGIN: "https://login.example.invalid" },
        "http://localhost:3001",
      ),
    /Reconstrua/,
  );
  assert.throws(
    () =>
      publicApiOrigin({
        PUBLIC_API_ORIGIN: "https://login.example.invalid",
        NEXT_PUBLIC_API_ORIGIN: "http://localhost:3001",
      }),
    /diverge/,
  );
  assert.throws(
    () => publicApiOrigin({ COOKIE_SECURE: "false" }),
    /COOKIE_SECURE foi removida/,
  );
  for (const origin of [
    "file:///etc/passwd",
    "https://login.example.invalid/path",
    "not-a-url",
    "https://user:secret@login.example.invalid",
  ])
    assert.throws(
      () => publicApiOrigin({ PUBLIC_API_ORIGIN: origin }),
      /PUBLIC_API_ORIGIN/,
    );
});
