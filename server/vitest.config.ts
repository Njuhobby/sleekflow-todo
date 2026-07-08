import { defineConfig } from "vitest/config";
import path from "node:path";

const TEST_DB_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://todo:todo@localhost:5432/todo_test";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "../shared/src"),
    },
  },
  test: {
    globalSetup: "./test/global-setup.ts",
    // Integration tests share one database — run files sequentially so
    // truncation in one file can't race another file's inserts.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: TEST_DB_URL,
    },
  },
});
