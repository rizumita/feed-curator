import { defineConfig } from "tsup";
import { cpSync, mkdirSync, readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("package.json", "utf-8"));

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  outDir: "dist",
  clean: true,
  splitting: false,
  sourcemap: false,
  external: ["sql.js", "bun:sqlite"],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  async onSuccess() {
    mkdirSync("dist/web", { recursive: true });
    cpSync("src/web/styles.css", "dist/web/styles.css");
    cpSync("src/web/scripts.js", "dist/web/scripts.js");
    cpSync("examples", "dist/examples", { recursive: true });
  },
});
