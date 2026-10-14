import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./verification-tests",
  testMatch: ["email-verification.spec.ts", "profile-inline.spec.ts"],
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:18630", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node verification-tests/email-verification-api.mjs",
      url: "http://localhost:18631/v1/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 18630",
      url: "http://localhost:18630/login",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        API_INTERNAL_ORIGIN: "http://localhost:18631",
        PUBLIC_API_ORIGIN: "http://localhost:18631",
        NEXT_PUBLIC_API_ORIGIN: "http://localhost:18631",
      },
    },
  ],
});
