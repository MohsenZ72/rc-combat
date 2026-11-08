import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["source"] },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
    // Reuse the repo .env (DATABASE_URL, secrets) for e2e tests.
    env: { ...loadEnv("test", "../..", ""), NODE_ENV: "test" },
  },
});
