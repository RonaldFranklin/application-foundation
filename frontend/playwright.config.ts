import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.LOGIN_TEST_FRONTEND_PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid test frontend port");
const baseURL = `http://localhost:${port}`;
export default defineConfig({
  testMatch: "**/*.spec.ts",
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !process.env.CI,
    env: { NEXT_TELEMETRY_DISABLED: "1" },
    timeout: 60000,
  },
});
