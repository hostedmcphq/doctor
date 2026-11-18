import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cachePath, refresh, runHook } from "../src/hook.js";
import { tempHome } from "./helpers/home.js";

const DAY = 86400_000;
const NOW = Date.UTC(2026, 10, 18, 12);
const ROOT = join(import.meta.dirname, "..");
const warnSummary = { level: "warn", count: 1, lines: ["db: 2 tools changed this week  hostedmcp.org/servers/acme/db/checks"] };

function withCache(entry: object | null) {
  const files: Record<string, object> = {};
  const t = tempHome(files);
  if (entry) {
    const p = cachePath(t.home);
    execFileSync("mkdir", ["-p", join(p, "..")]);
    writeFileSync(p, JSON.stringify({ [t.cwd]: entry }));
  }
  return t;
}

describe("SessionStart hook (docs/09 §4.5.5)", () => {
  it("silent when all ok", () => {
    const t = withCache({ at: NOW - 1000, summary: { level: "ok", count: 0, lines: [] } });
    const spawn = vi.fn();
    expect(runHook({ ...t, now: NOW, env: {}, spawnRefresh: spawn })).toBe("");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("prints systemMessage for warn from a fresh cache", () => {
    const t = withCache({ at: NOW - 1000, summary: warnSummary });
    const out = JSON.parse(runHook({ ...t, now: NOW, env: {}, spawnRefresh: vi.fn() })) as { systemMessage: string };
    expect(out.systemMessage).toBe("HostedMCP: 1 of your MCP servers needs a look\n  db: 2 tools changed this week  hostedmcp.org/servers/acme/db/checks");
  });

  it("stale cache spawns one refresh and still answers", () => {
    const t = withCache({ at: NOW - 2 * DAY, summary: warnSummary });
    const spawn = vi.fn();
    expect(runHook({ ...t, now: NOW, env: {}, spawnRefresh: spawn })).toContain("needs a look");
    expect(runHook({ ...t, now: NOW + 1000, env: {}, spawnRefresh: spawn })).toContain("needs a look");
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("no cache yet: spawns a refresh and prints nothing", () => {
    const t = withCache(null);
    const spawn = vi.fn();
    expect(runHook({ ...t, now: NOW, env: {}, spawnRefresh: spawn })).toBe("");
    expect(spawn).toHaveBeenCalledOnce();
  });

  it("hook returns while refresh is pending", () => {
    const t = withCache(null);
    const started = Date.now();
    const out = runHook({ ...t, now: NOW, env: {}, spawnRefresh: () => void new Promise(() => {}) });
    expect(out).toBe("");
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("off when HOSTEDMCP_DOCTOR=off", () => {
    const t = withCache({ at: NOW - 1000, summary: warnSummary });
    const spawn = vi.fn();
    expect(runHook({ ...t, now: NOW - 0, env: { HOSTEDMCP_DOCTOR: "off" }, spawnRefresh: spawn })).toBe("");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("refresh writes the summary, and keeps the old cache when offline", async () => {
    const t = tempHome({ ".cursor/mcp.json": { mcpServers: { db: { command: "npx", args: ["-y", "@acme/db@1.0.0"] } } } });
    const answer = { checkedAt: "x", results: [{ index: 0, level: "warn", status: "match", listing: { owner: "acme", name: "db", title: "Acme DB", url: "https://hostedmcp.org/servers/acme/db" }, notes: ["2 tools changed this week"] }] };
    await refresh({ ...t, now: NOW, platform: "linux", env: {}, fetch: (async () => new Response(JSON.stringify(answer))) as unknown as typeof fetch });
    const cached = JSON.parse(readFileSync(cachePath(t.home), "utf8"))[t.cwd];
    expect(cached).toMatchObject({ at: NOW, summary: { level: "warn", count: 1 } });
    await refresh({ ...t, now: NOW + DAY, platform: "linux", env: {}, fetch: (async () => { throw new TypeError("offline"); }) as unknown as typeof fetch });
    expect(JSON.parse(readFileSync(cachePath(t.home), "utf8"))[t.cwd]).toMatchObject({ at: NOW, summary: { count: 1 } });
  });

  it("hook bundle has no dependency imports", () => {
    execFileSync("node", ["build.mjs"], { cwd: ROOT });
    const src = readFileSync(join(ROOT, "plugin/dist/hook.mjs"), "utf8");
    const imports = [...src.matchAll(/^import\b[^;]*?from\s*"([^"]+)"|^import\s*"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)|\brequire\(\s*"([^"]+)"\s*\)/gm)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]);
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i, i).toMatch(/^node:|^(fs|os|path|child_process|crypto|url)$/);
  });

  it("marketplace and plugin manifests parse and name the hook file", () => {
    const market = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8")) as { name: string; plugins: { name: string; source: string }[] };
    expect(market.plugins).toEqual([expect.objectContaining({ name: "hostedmcp", source: "./plugin" })]);
    const plugin = JSON.parse(readFileSync(join(ROOT, "plugin/.claude-plugin/plugin.json"), "utf8")) as { name: string };
    expect(plugin.name).toBe("hostedmcp");
    const hooks = JSON.parse(readFileSync(join(ROOT, "plugin/hooks/hooks.json"), "utf8")) as { hooks: { SessionStart: { hooks: { command: string; timeout: number }[] }[] } };
    expect(hooks.hooks.SessionStart[0]!.hooks[0]).toMatchObject({ type: "command", timeout: 5 });
    expect(hooks.hooks.SessionStart[0]!.hooks[0]!.command).toContain("${CLAUDE_PLUGIN_ROOT}/dist/hook.mjs");
    const mcp = JSON.parse(readFileSync(join(ROOT, "plugin/.mcp.json"), "utf8")) as { mcpServers: Record<string, { url: string }> };
    expect(mcp.mcpServers.hostedmcp!.url).toBe("https://api.hostedmcp.org/mcp");
    expect(readFileSync(join(ROOT, "plugin/skills/mcp-doctor/SKILL.md"), "utf8")).toMatch(/^---\nname: mcp-doctor\ndescription: /);
  });
});
