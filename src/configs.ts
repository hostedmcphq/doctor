/**
 * Where AI clients keep their MCP servers, and how to read them. Only `command`, `args`, `url`, `serverUrl`,
 * `httpUrl` and `disabled` of an entry are read; identify() keeps just the package or the remote host + hash.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { identify } from "./identity.js";
import type { DoctorItem, ServerEntry } from "./types.js";

export interface ConfigFile {
  client: string;
  path: string;
  /** Object key that holds the servers. */
  key: "mcpServers" | "servers" | "context_servers";
  /** ~/.claude.json: also the `projects[cwd].mcpServers` scope. */
  claudeCode?: boolean;
}

export interface FindOptions {
  home: string;
  cwd: string;
  platform: NodeJS.Platform;
  /** %APPDATA% on Windows; defaults to home/AppData/Roaming. */
  appData?: string;
}

export function findConfigs(o: FindOptions): ConfigFile[] {
  const h = (...p: string[]) => join(o.home, ...p);
  const c = (...p: string[]) => join(o.cwd, ...p);
  const appData = o.appData ?? h("AppData", "Roaming");
  const appDir = o.platform === "darwin" ? h("Library", "Application Support") : o.platform === "win32" ? appData : h(".config");
  return [
    { client: "claude-code", path: h(".claude.json"), key: "mcpServers", claudeCode: true },
    { client: "claude-code", path: c(".mcp.json"), key: "mcpServers" },
    { client: "claude-desktop", path: join(appDir, "Claude", "claude_desktop_config.json"), key: "mcpServers" },
    { client: "cursor", path: h(".cursor", "mcp.json"), key: "mcpServers" },
    { client: "cursor", path: c(".cursor", "mcp.json"), key: "mcpServers" },
    { client: "vscode", path: c(".vscode", "mcp.json"), key: "servers" },
    { client: "vscode", path: join(appDir, "Code", "User", "mcp.json"), key: "servers" },
    { client: "gemini-cli", path: h(".gemini", "settings.json"), key: "mcpServers" },
    { client: "gemini-cli", path: c(".gemini", "settings.json"), key: "mcpServers" },
    { client: "windsurf", path: h(".codeium", "windsurf", "mcp_config.json"), key: "mcpServers" },
    { client: "cline", path: h(".cline", "data", "settings", "cline_mcp_settings.json"), key: "mcpServers" },
    { client: "cline", path: join(appDir, "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"), key: "mcpServers" },
    { client: "zed", path: h(".config", "zed", "settings.json"), key: "context_servers" },
  ];
}

/** JSON with comments and trailing commas (VS Code, Zed): comments and dangling commas removed outside strings. */
export function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (ch === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

type RawEntry = ServerEntry & { serverUrl?: string; httpUrl?: string; disabled?: boolean; command?: unknown };

function entries(obj: unknown): [string, RawEntry][] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj as Record<string, RawEntry>).filter(([, e]) => e && typeof e === "object" && e.disabled !== true);
}

/** Zed writes `command: { path, args }`; everything else `command` + `args`. */
function normalize(e: RawEntry): ServerEntry & { serverUrl?: string; httpUrl?: string } {
  const cmd = e.command as unknown;
  if (cmd && typeof cmd === "object") {
    const z = cmd as { path?: unknown; args?: unknown };
    return { command: typeof z.path === "string" ? z.path : undefined, args: Array.isArray(z.args) ? (z.args as string[]) : undefined };
  }
  return { command: typeof cmd === "string" ? cmd : undefined, args: Array.isArray(e.args) ? e.args : undefined, url: e.url, serverUrl: e.serverUrl, httpUrl: e.httpUrl, type: e.type };
}

export function readServers(cfg: ConfigFile, cwd: string): { client: string; name: string; entry: ServerEntry }[] {
  let data: Record<string, unknown>;
  try {
    data = parseJsonc(readFileSync(cfg.path, "utf8")) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const found = entries(data[cfg.key]);
  if (cfg.claudeCode) {
    const projects = data.projects as Record<string, { mcpServers?: unknown }> | undefined;
    found.push(...entries(projects?.[cwd]?.mcpServers));
  }
  return found.map(([name, e]) => ({ client: cfg.client, name, entry: normalize(e) }));
}

export interface Installed {
  client: string;
  /** The user's own name for the server: shown locally, never sent. */
  name: string;
  /** null: a local command, not sent. */
  item: DoctorItem | null;
}

export function collect(o: FindOptions & { client?: string }): Installed[] {
  return findConfigs(o)
    .filter((c) => !o.client || c.client === o.client)
    .flatMap((c) => readServers(c, o.cwd))
    .map((s) => ({ client: s.client, name: s.name, item: identify(s.entry) }));
}
