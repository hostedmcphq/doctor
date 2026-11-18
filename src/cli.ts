/**
 * npx @hosted-mcp/doctor [--json] [--client <slug>] [--api <url>]
 * Exit codes: 0 ok or info, 1 warn, 2 bad (an unreachable API is 0: nothing was checked).
 */
import { homedir } from "node:os";
import { check } from "./api.js";
import { collect } from "./configs.js";
import { exitCode, link } from "./report.js";
import type { DoctorResult } from "./types.js";

export interface CliDeps {
  home: string;
  cwd: string;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
  print: (s: string) => void;
}

const STATUS = (r: DoctorResult | null, sent: boolean) => (!sent ? "local" : !r || r.status === "unknown" ? "not listed" : r.status === "ambiguous" ? "several" : r.level);

export async function main(argv: string[], d: CliDeps): Promise<number> {
  const flag = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const json = argv.includes("--json");
  const client = flag("--client");
  const installed = collect({ home: d.home, cwd: d.cwd, platform: d.platform, appData: d.env.APPDATA, client });
  if (installed.length === 0) {
    d.print(json ? JSON.stringify({ checkedAt: null, servers: [] }) : "No MCP servers found in the configs of Claude Code, Claude Desktop, Cursor, VS Code, Gemini CLI, Windsurf, Cline or Zed.");
    return 0;
  }
  const sent = installed.filter((s) => s.item);
  const res = sent.length ? await check(sent.map((s) => s.item!), { api: flag("--api"), client, fetch: d.fetch }) : { checkedAt: new Date().toISOString(), results: [] };
  if (!res) {
    d.print(json ? JSON.stringify({ error: "unreachable" }) : "Could not reach hostedmcp.org; nothing was checked.");
    return 0;
  }
  let k = 0;
  const rows = installed.map((s) => ({ ...s, result: s.item ? (res.results[k++] ?? null) : null }));
  if (json) {
    d.print(JSON.stringify({ checkedAt: res.checkedAt, servers: rows.map((r) => ({ client: r.client, name: r.name, sent: !!r.item, result: r.result })) }, null, 2));
  } else {
    const table = [["Server", "Client", "Status", "Note", "Link"], ...rows.map((r) => [r.name, r.client, STATUS(r.result, !!r.item), r.result?.notes[0] ?? (r.item ? "" : "runs a local command; not sent"), r.result ? link(r.result) : ""])];
    const widths = table[0]!.map((_, c) => Math.min(48, Math.max(...table.map((row) => row[c]!.length))));
    for (const row of table) d.print(row.map((cell, c) => cell.slice(0, 48).padEnd(widths[c]!)).join("  ").trimEnd());
  }
  return exitCode(rows.map((r) => r.result));
}

// Run when executed directly (dist/cli.mjs), not when imported by tests.
if (process.argv[1] && /cli\.m?js$/.test(process.argv[1])) {
  main(process.argv.slice(2), { home: homedir(), cwd: process.cwd(), platform: process.platform, env: process.env, print: (s) => console.log(s) }).then(
    (code) => process.exit(code),
    () => process.exit(0),
  );
}
