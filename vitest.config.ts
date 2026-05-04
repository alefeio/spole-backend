import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15_000,
    // Migrações em paralelo entre arquivos podem disputar criação de tipos/enums no Postgres.
    fileParallelism: false,
    environment: "node",
    setupFiles: ["test/test-env.ts"],
    include: ["test/**/*.test.ts"],
    exclude: ["test/**/*.infra.test.ts"]
  }
});
