import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src"),
      // `server-only` is a build-time guard for the Next bundler and has no
      // runtime module; stub it so server modules are unit-testable.
      "server-only": path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "src/test/server-only-stub.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
