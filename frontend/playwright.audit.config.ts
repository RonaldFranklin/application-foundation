import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./audit-tests",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:18930", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node audit-tests/api.mjs",
      url: "http://localhost:18931/v1/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 18930",
      url: "http://localhost:18930/admin/login",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        API_INTERNAL_ORIGIN: "http://localhost:18931",
        PUBLIC_API_ORIGIN: "http://localhost:18931",
        NEXT_PUBLIC_API_ORIGIN: "http://localhost:18931",
      },
    },
  ],
});
