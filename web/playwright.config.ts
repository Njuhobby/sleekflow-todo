import { defineConfig } from "@playwright/test";

/**
 * The E2E runs against the real stack: Fastify + Postgres (the todo_test
 * database, schema-pushed on boot) and the Vite dev server proxying /api.
 */
const E2E_DB =
  process.env.DATABASE_URL_TEST ?? "postgresql://todo:todo@localhost:5432/todo_test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: `npx prisma db push --skip-generate && npx tsx src/server.ts`,
      cwd: "../server",
      port: 3001,
      reuseExistingServer: false,
      env: { DATABASE_URL: E2E_DB, NODE_ENV: "test" },
      timeout: 60_000,
    },
    {
      command: "npx vite --port 5173 --strictPort",
      port: 5173,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
