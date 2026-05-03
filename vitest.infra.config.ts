import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["test/test-env.ts"],
    include: ["test/**/*.infra.test.ts"]
  }
});

