import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Business rules and adapters are pure logic: no browser and no database needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests must never reach a real provider or a real database.
    env: {
      NODE_ENV: "test",
    },
  },
});
