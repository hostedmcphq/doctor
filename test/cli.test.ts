import { describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { tempHome } from "./helpers/home.js";

const run = async (args: string[], t: { home: string; cwd: string }, fetch: typeof globalThis.fetch) => {
  const out: string[] = [];
  const code = await main(args, { home: t.home, cwd: t.cwd, platform: "linux", env: {}, fetch, print: (s) => out.push(s) });
  return { code, out: out.join("\n") };
};

describe("cli", () => {
  const t = tempHome({ ".cursor/mcp.json": { mcpServers: { db: { command: "npx", args: ["-y", "@acme/db@1.0.0"] }, mine: { command: "node", args: ["s.js"] } } } });
  const answer = { checkedAt: "2026-11-18T12:00:00.000Z", results: [{ index: 0, level: "bad", status: "match", listing: { owner: "acme", name: "db", title: "Acme DB", url: "https://hostedmcp.org/servers/acme/db" }, notes: ["archived"] }] };
  const fetch = vi.fn(async () => new Response(JSON.stringify(answer))) as unknown as typeof globalThis.fetch;

  it("prints a table and exits 2 for a bad server", async () => {
    const r = await run([], t, fetch);
    expect(r.code).toBe(2);
    expect(r.out).toMatch(/db\s+cursor\s+bad\s+archived\s+hostedmcp\.org\/servers\/acme\/db/);
    expect(r.out).toMatch(/mine\s+cursor\s+local/);
  });

  it("cli --json prints the response", async () => {
    const r = await run(["--json"], t, fetch);
    const j = JSON.parse(r.out) as { checkedAt: string; servers: { name: string; client: string; sent: boolean; result: { level: string } | null }[] };
    expect(j.checkedAt).toBe(answer.checkedAt);
    expect(j.servers).toEqual([
      { client: "cursor", name: "db", sent: true, result: answer.results[0] },
      { client: "cursor", name: "mine", sent: false, result: null },
    ]);
  });

  it("offline: says so and exits 0", async () => {
    const r = await run([], t, (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof globalThis.fetch);
    expect(r.code).toBe(0);
    expect(r.out).toContain("Could not reach hostedmcp.org");
  });

  it("--client filters to one client", async () => {
    const r = await run(["--client", "vscode"], t, fetch);
    expect(r.out).toContain("No MCP servers found");
  });
});
