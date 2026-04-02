import { defineConfig } from "tsup";
import { cpSync, readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  external: ["sql.js"],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  async onSuccess() {
    cpSync("src/web", "dist/web", { recursive: true });
  },
});
