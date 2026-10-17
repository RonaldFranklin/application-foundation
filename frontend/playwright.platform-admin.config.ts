import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./platform-admin-tests",
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:19030",
    trace: "off",
    timezoneId: "America/Sao_Paulo",
    locale: "pt-BR",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node platform-admin-tests/api.mjs",
      url: "http://localhost:19031/v1/health",
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --port 19030",
      url: "http://localhost:19030/admin/login",
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
