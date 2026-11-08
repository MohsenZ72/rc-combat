import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["source"] },
  test: { include: ["test/**/*.test.ts"], testTimeout: 20000 },
});
