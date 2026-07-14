import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  expect: { timeout: 10_000 },
  webServer: {
    command: "pnpm build && pnpm exec vinext start -p 4173 -H 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://index_analyzer:index_analyzer@127.0.0.1:55433/index_analyzer",
      CONTROL_DATABASE_URL:
        process.env.CONTROL_DATABASE_URL ??
        process.env.DATABASE_URL ??
        "postgres://index_analyzer:index_analyzer@127.0.0.1:55433/index_analyzer",
      INDEX_ANALYZER_TARGETS:
        process.env.INDEX_ANALYZER_TARGETS ??
        "local:Local PostgreSQL:DATABASE_URL",
      AI_MOCK_MODE: process.env.AI_MOCK_MODE ?? "true",
      EXPLAIN_CONFIRMATION_SECRET:
        process.env.EXPLAIN_CONFIRMATION_SECRET ??
        "local-development-confirmation-secret",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
