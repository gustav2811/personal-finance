import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    resolve: {
      alias: {
        "@investments/finwise": path.resolve(__dirname, "../../libs/finwise/src"),
      },
    },
  },
  resolve: {
    alias: {
      "@investments/finwise": path.resolve(__dirname, "../../libs/finwise/src"),
    },
  },
});
