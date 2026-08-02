import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Test FILES run sequentially. Many files are integration tests against
    // the one local Supabase stack, and several share the seeded demo tenant
    // (engine.test.ts counts its members/messages while others join members,
    // flip program configs, or send texts). Parallel file execution made
    // those races flake roughly one run in five — three build agents
    // independently hit it. Sequential files cost ~30-60s of wall clock and
    // buy determinism. Tests WITHIN a file still run per their own order.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./src/test/server-only-stub.ts"),
    },
  },
});
