import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { check } from "../src/api.js";
import { collect, findConfigs } from "../src/configs.js";
import { tempHome } from "./helpers/home.js";

describe("config readers (docs/09 §4.5.3)", () => {
  it("finds configs per client on darwin, linux and win32", () => {
    const { home, cwd } = tempHome({});
    const clients = (platform: NodeJS.Platform) => findConfigs({ home, cwd, platform, appData: `${home}/AppData/Roaming` }).map((c) => `${c.client} ${c.path.replace(cwd, "$cwd").replace(home, "~")}`);
    expect(clients("darwin")).toEqual(expect.arrayContaining([
      "claude-code ~/.claude.json", "claude-code $cwd/.mcp.json", "claude-desktop ~/Library/Application Support/Claude/claude_desktop_config.json",
      "cursor ~/.cursor/mcp.json", "cursor $cwd/.cursor/mcp.json", "vscode $cwd/.vscode/mcp.json", "vscode ~/Library/Application Support/Code/User/mcp.json",
      "gemini-cli ~/.gemini/settings.json", "windsurf ~/.codeium/windsurf/mcp_config.json", "zed ~/.config/zed/settings.json",
    ]));
    expect(clients("linux")).toContain("claude-desktop ~/.config/Claude/claude_desktop_config.json");
    expect(clients("win32")).toContain("claude-desktop ~/AppData/Roaming/Claude/claude_desktop_config.json");
  });

  it("reads Claude Code user and project scopes, VS Code servers and Zed context_servers", () => {
    const t = tempHome({
      ".claude.json": { mcpServers: { gh: { command: "npx", args: ["-y", "@github/mcp@1.0.0"] } }, projects: { "PLACEHOLDER": { mcpServers: { db: { type: "http", url: "https://db.example/mcp" } } }, "/other": { mcpServers: { no: { command: "npx", args: ["x"] } } } } },
      "$cwd/.vscode/mcp.json": `{
        // comment
        "servers": { "fetch": { "command": "uvx", "args": ["mcp-server-fetch"], }, },
      }`,
      ".config/zed/settings.json": { context_servers: { z: { command: { path: "npx", args: ["-y", "zed-mcp"] } } } },
    });
    // Rewrite the project key to the real cwd.
    const p = `${t.home}/.claude.json`;
    writeFileSync(p, readFileSync(p, "utf8").replace("PLACEHOLDER", t.cwd));
    const got = collect({ home: t.home, cwd: t.cwd, platform: "darwin" }).map((s) => `${s.client}:${s.name}:${s.item?.kind}`);
    expect(got.sort()).toEqual(["claude-code:db:remote", "claude-code:gh:npm", "vscode:fetch:pypi", "zed:z:npm"]);
  });

  it("reads JSONC and skips broken files", () => {
    const t = tempHome({
      ".cursor/mcp.json": "{ not json",
      "$cwd/.cursor/mcp.json": "",
      ".gemini/settings.json": `/* block */ { "mcpServers": { "g": { "httpUrl": "https://g.example/mcp" } } }`,
    });
    const got = collect({ home: t.home, cwd: t.cwd, platform: "linux" });
    expect(got.map((s) => `${s.client}:${s.name}`)).toEqual(["gemini-cli:g"]);
  });

  it("skips servers marked disabled", () => {
    const t = tempHome({ ".cursor/mcp.json": { mcpServers: { a: { command: "npx", args: ["a"], disabled: true }, b: { command: "npx", args: ["b"] } } } });
    expect(collect({ home: t.home, cwd: t.cwd, platform: "linux" }).map((s) => s.name)).toEqual(["b"]);
  });

  it("sanitize: key in path never leaves", async () => {
    const t = tempHome({
      ".cursor/mcp.json": {
        mcpServers: {
          "my-secret-name": { url: "https://api.x.com/mcp/s/abc123/mcp?key=sk-live-1", headers: { Authorization: "Bearer tok-999" } },
          local: { command: "node", args: [`/Users/someone/private/server.js`], env: { API_KEY: "env-secret-42" } },
          pkg: { command: "npx", args: ["-y", "@acme/db@1.2.0", "--token", "arg-secret-7"], env: { DB_URL: "postgres://u:p@h/db" } },
        },
      },
    });
    const items = collect({ home: t.home, cwd: t.cwd, platform: "linux" });
    let body = "";
    const fetch = vi.fn(async (_u: string, init: RequestInit) => ((body = String(init.body)), new Response(JSON.stringify({ checkedAt: "x", results: [] }))));
    await check(items.map((s) => s.item).filter((i) => i !== null), { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(fetch).toHaveBeenCalledOnce();
    for (const secret of ["abc123", "key=", "sk-live", "tok-999", "env-secret", "arg-secret", "postgres", "my-secret-name", "/Users/", "server.js", t.home]) expect(body, secret).not.toContain(secret);
    expect(JSON.parse(body).servers).toHaveLength(2);
  });

  it("api failure returns null", async () => {
    const down = vi.fn(async () => new Response("nope", { status: 503 }));
    expect(await check([{ kind: "npm", id: "a" }], { fetch: down as unknown as typeof globalThis.fetch })).toBeNull();
    const offline = vi.fn(async () => { throw new TypeError("fetch failed"); });
    expect(await check([{ kind: "npm", id: "a" }], { fetch: offline as unknown as typeof globalThis.fetch })).toBeNull();
  });

  it("dedupes and splits into calls of at most 50, results back in input order", async () => {
    const calls: number[] = [];
    const fetch = vi.fn(async (_u: string, init: RequestInit) => {
      const servers = JSON.parse(String(init.body)).servers as { id: string }[];
      calls.push(servers.length);
      return new Response(JSON.stringify({ checkedAt: "t", results: servers.map((s, index) => ({ index, level: "ok", status: "unknown", notes: [s.id] })) }));
    });
    const items = [...Array.from({ length: 60 }, (_, i) => ({ kind: "npm" as const, id: `p${i}` })), { kind: "npm" as const, id: "p3" }];
    const r = await check(items, { fetch: fetch as unknown as typeof globalThis.fetch });
    expect(calls).toEqual([50, 10]);
    expect(r!.results.map((x) => x.notes[0])).toEqual(items.map((i) => i.id));
  });
});
