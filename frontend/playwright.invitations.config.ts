import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./invitation-tests",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:18830", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node invitation-tests/api.mjs",
      url: "http://localhost:18831/v1/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 18830",
      url: "http://localhost:18830/invitations/accept",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        API_INTERNAL_ORIGIN: "http://localhost:18831",
        PUBLIC_API_ORIGIN: "http://localhost:18831",
        NEXT_PUBLIC_API_ORIGIN: "http://localhost:18831",
      },
    },
  ],
});
