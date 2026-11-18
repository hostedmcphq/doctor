import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

describe("bundles run when reached through a symlink (review C2, I3)", () => {
  beforeAll(() => execFileSync("node", ["build.mjs"], { cwd: ROOT }));

  it("npx-style bin symlink still runs the CLI", () => {
    const dir = mkdtempSync(join(tmpdir(), "doctor-bin-"));
    const link = join(dir, "hosted-mcp-doctor");
    symlinkSync(join(ROOT, "dist/cli.mjs"), link);
    const home = mkdtempSync(join(tmpdir(), "doctor-home-"));
    const out = execFileSync("node", [link, "--client", "zed"], { env: { ...process.env, HOME: home }, cwd: home, encoding: "utf8" });
    expect(out).toContain("No MCP servers found");
  });

  it("hook through a symlinked plugin folder still answers from the cache", () => {
    const home = mkdtempSync(join(tmpdir(), "doctor-home-"));
    const cwd = join(home, "proj");
    mkdirSync(join(home, ".cache", "hostedmcp"), { recursive: true });
    mkdirSync(cwd);
    writeFileSync(join(home, ".cache/hostedmcp/doctor.json"), JSON.stringify({ [cwd]: { at: Date.now(), summary: { level: "bad", count: 1, lines: ["db: archived  hostedmcp.org/servers/a/db"] } } }));
    const linked = join(home, "plugin-link");
    symlinkSync(join(ROOT, "plugin"), linked);
    const out = execFileSync("node", [join(linked, "dist/hook.mjs")], { env: { ...process.env, HOME: home, CLAUDE_PROJECT_DIR: cwd }, encoding: "utf8" });
    expect(JSON.parse(out).systemMessage).toContain("needs a look");
    void readFileSync;
  });
});
