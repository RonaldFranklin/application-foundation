import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./customer-tests",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:19030", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node customer-tests/api.mjs",
      url: "http://localhost:19031/v1/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 19030",
      url: "http://localhost:19030/customer/login",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        API_INTERNAL_ORIGIN: "http://localhost:19031",
        PUBLIC_API_ORIGIN: "http://localhost:19031",
        NEXT_PUBLIC_API_ORIGIN: "http://localhost:19031",
      },
    },
  ],
});
