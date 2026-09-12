import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Integration tests: real Postgres, real sessions, real server actions.
 *
 * A separate config rather than a flag on the main one, for two reasons.
 * `npm test` has to stay fast and runnable with nothing installed — a suite
 * that needs a database is a suite people stop running. And these must not run
 * in parallel: they share one database, and a test that moves a candidate
 * while another is counting them fails for reasons that have nothing to do
 * with the code.
 *
 * Run with `npm run test:integration`, after `npm run db:up && npm run db:seed`.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "src/test/server-only-stub.ts"),
      // The Next request context. Aliased rather than mocked so it holds for
      // every file without hoisting rules, and so the harness can import the
      // same module the actions do and drive it directly.
      "next/headers": path.resolve(root, "src/server/__integration__/next-stubs.ts"),
      "next/cache": path.resolve(root, "src/server/__integration__/next-stubs.ts"),
      "next/navigation": path.resolve(root, "src/server/__integration__/next-stubs.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.itest.ts"],
    // One file at a time, one test at a time, in order.
    fileParallelism: false,
    sequence: { concurrent: false },
    // A round trip to Postgres plus a scrypt hash is slower than a pure unit
    // test, and a timeout that fires on a slow machine is a flake, not a bug.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
