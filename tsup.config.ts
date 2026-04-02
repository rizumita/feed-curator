import { defineConfig } from "tsup";
import { cpSync } from "fs";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  external: ["sql.js"],
  async onSuccess() {
    cpSync("src/web", "dist/web", { recursive: true });
  },
});
