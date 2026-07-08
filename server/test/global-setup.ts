import { execSync } from "node:child_process";

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://todo:todo@localhost:5432/todo_test";

/** Sync the Prisma schema into the test database before any test runs. */
export default function globalSetup() {
  execSync("npx prisma db push --skip-generate", {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "inherit",
  });
}
