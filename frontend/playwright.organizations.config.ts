import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./organization-tests",
  workers: 1,
  reporter: "list",
  use: { baseURL: "http://localhost:18730", trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "cd ../backend && npx tsx test/organization-browser-server.ts",
      url: "http://localhost:18731/v1/health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command: "npm run dev -- --port 18730",
      url: "http://localhost:18730/login",
      reuseExistingServer: false,
      timeout: 60000,
      env: {
        NEXT_TELEMETRY_DISABLED: "1",
        API_INTERNAL_ORIGIN: "http://localhost:18731",
        PUBLIC_API_ORIGIN: "http://localhost:18731",
        NEXT_PUBLIC_API_ORIGIN: "http://localhost:18731",
      },
    },
  ],
});
