import path from "node:path";
import { defineConfig } from "vitest/config";

const finwiseSrc = path.resolve(__dirname, "../../libs/finwise/src");

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    include: ["../../libs/ingest-core/src/**/*.test.ts"],
    passWithNoTests: false,
    server: {
      deps: {
        inline: ["xlsx"],
      },
    },
  },
  resolve: {
    alias: {
      "@investments/finwise": finwiseSrc,
      xlsx: path.resolve(__dirname, "node_modules/xlsx/xlsx.js"),
    },
  },
});
