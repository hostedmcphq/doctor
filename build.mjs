// Bundles the CLI and the Claude Code hook into single files with no dependencies (docs/09 §4.5.5), and copies them
// into the plugin folder so the plugin runs without npm.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

const common = { bundle: true, platform: "node", format: "esm", target: "node20", logLevel: "warning" };
const outputs = [
  { entry: "src/cli.ts", out: "cli.mjs", banner: { js: "#!/usr/bin/env node" } },
  { entry: "src/hook.ts", out: "hook.mjs" },
].filter((o) => existsSync(o.entry));

mkdirSync("plugin/dist", { recursive: true });
for (const o of outputs) {
  await build({ ...common, entryPoints: [o.entry], outfile: `dist/${o.out}`, ...(o.banner ? { banner: o.banner } : {}) });
  cpSync(`dist/${o.out}`, `plugin/dist/${o.out}`);
}
