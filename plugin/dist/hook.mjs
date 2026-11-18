// src/hook.ts
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync as readFileSync2, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join as join2 } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";

// src/api.ts
var API = "https://api.hostedmcp.org/v1/doctor";
var MAX = 50;
var key = (i) => JSON.stringify(i);
async function check(items, o = {}) {
  const unique = [...new Map(items.map((i) => [key(i), i])).values()];
  const f = o.fetch ?? globalThis.fetch;
  const byKey = /* @__PURE__ */ new Map();
  let checkedAt = (/* @__PURE__ */ new Date()).toISOString();
  try {
    for (let i = 0; i < unique.length; i += MAX) {
      const chunk = unique.slice(i, i + MAX);
      const res = await f(o.api ?? API, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "hosted-mcp-doctor/0.1" },
        body: JSON.stringify(o.client ? { client: o.client, servers: chunk } : { servers: chunk }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 1e4)
      });
      if (!res.ok) return null;
      const body = await res.json();
      if (!Array.isArray(body?.results)) return null;
      checkedAt = body.checkedAt ?? checkedAt;
      for (const r of body.results) {
        const item = chunk[r.index];
        if (item) byKey.set(key(item), r);
      }
    }
  } catch {
    return null;
  }
  return {
    checkedAt,
    results: items.map((it, index) => ({ ...byKey.get(key(it)) ?? { level: "ok", status: "unknown", notes: [] }, index }))
  };
}

// src/configs.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

// src/hash.ts
import { createHash } from "node:crypto";
var sha256Hex = (s) => createHash("sha256").update(s).digest("hex");

// src/identity.ts
function normUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
}
function publicHost(host) {
  const name = host.replace(/:\d+$/, "");
  if (!name.includes(".") || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(name)) return false;
  return !/(^|\.)(localhost|local|internal|lan|home)$/.test(name);
}
function remote(url) {
  const norm = normUrl(url);
  if (!norm) return null;
  const host = norm.split("/")[0];
  return publicHost(host) ? { kind: "remote", host, hash: sha256Hex(norm) } : null;
}
var base = (cmd) => cmd.split(/[\\/]/).pop().replace(/\.(cmd|exe|bat)$/i, "").toLowerCase();
var localish = (spec) => /^(\.|\/|~|[a-z]:\\)|:\/\/|^(git|file|link|github):/i.test(spec);
var versionish = (v) => v && /^v?\d[\w.+-]*$/.test(v) ? v.replace(/^v/, "") : void 0;
function npmSpec(spec) {
  if (localish(spec)) return null;
  const at = spec.lastIndexOf("@");
  const [id, v] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, void 0];
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(id)) return null;
  const version = versionish(v);
  return version ? { kind: "npm", id, version } : { kind: "npm", id };
}
function pypiSpec(spec) {
  if (localish(spec)) return null;
  const m = spec.match(/^([A-Za-z0-9][\w.-]*)(\[[^\]]*\])?(?:(==|@)([^,;\s]+))?$/);
  if (!m) return null;
  const version = versionish(m[4]);
  return version ? { kind: "pypi", id: m[1], version } : { kind: "pypi", id: m[1] };
}
var DOCKER_VALUE_FLAGS = /* @__PURE__ */ new Set(["-e", "--env", "-v", "--volume", "--name", "-p", "--publish", "--network", "--net", "--mount", "-w", "--workdir", "-u", "--user", "--entrypoint", "--platform", "--env-file", "-l", "--label", "--add-host", "--cpus", "-m", "--memory", "--pull", "--restart", "-h", "--hostname"]);
function ociImage(args) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (DOCKER_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    const ref = a.replace(/@sha256:[0-9a-f]{64}$/, "");
    const slash = ref.lastIndexOf("/");
    const colon = ref.lastIndexOf(":");
    const [id, tag] = colon > slash ? [ref.slice(0, colon), ref.slice(colon + 1)] : [ref, void 0];
    if (!/^[a-z0-9][\w./-]*$/.test(id)) return null;
    const version = tag && tag !== "latest" ? tag : void 0;
    return version ? { kind: "oci", id, version } : { kind: "oci", id };
  }
  return null;
}
var REMOTE_WRAPPERS = /* @__PURE__ */ new Set(["mcp-remote", "@modelcontextprotocol/mcp-remote", "supergateway"]);
function firstSpec(args, valueFlags) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (valueFlags.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return { spec: a, rest: args.slice(i + 1) };
  }
  return null;
}
function identify(entry) {
  const url = entry.url ?? entry.serverUrl ?? entry.httpUrl;
  if (typeof url === "string" && url) return remote(url);
  if (typeof entry.command !== "string" || !entry.command) return null;
  let cmd = base(entry.command);
  let args = Array.isArray(entry.args) ? entry.args.filter((a) => typeof a === "string") : [];
  if (cmd === "cmd" && /^\/c$/i.test(args[0] ?? "")) {
    cmd = base(args[1] ?? "");
    args = args.slice(2);
  }
  if ((cmd === "pnpm" || cmd === "yarn") && args[0] === "dlx") {
    cmd = "npx";
    args = args.slice(1);
  }
  if (cmd === "uv" && args[0] === "tool" && args[1] === "run") {
    cmd = "uvx";
    args = args.slice(2);
  }
  if (cmd === "pipx" && args[0] === "run") {
    cmd = "uvx";
    args = args.slice(1);
  }
  if (cmd === "npx" || cmd === "bunx") {
    const pkgFlag = args.findIndex((a) => a === "-p" || a === "--package");
    const first = pkgFlag >= 0 ? { spec: args[pkgFlag + 1] ?? "", rest: [] } : firstSpec(args, /* @__PURE__ */ new Set(["--registry", "--cache"]));
    if (!first) return null;
    const pkg = npmSpec(first.spec);
    if (pkg && pkg.kind === "npm" && REMOTE_WRAPPERS.has(pkg.id)) {
      const target = first.rest.find((a) => /^https?:\/\//i.test(a));
      return target ? remote(target) : null;
    }
    return pkg;
  }
  if (cmd === "uvx") {
    const from = args.indexOf("--from");
    if (from >= 0) return pypiSpec(args[from + 1] ?? "");
    const first = firstSpec(args, /* @__PURE__ */ new Set(["--with", "--python", "-p", "--index-url", "--index"]));
    return first ? pypiSpec(first.spec) : null;
  }
  if ((cmd === "docker" || cmd === "podman") && args[0] === "run") return ociImage(args.slice(1));
  return null;
}

// src/configs.ts
function findConfigs(o) {
  const h = (...p) => join(o.home, ...p);
  const c = (...p) => join(o.cwd, ...p);
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
    { client: "zed", path: h(".config", "zed", "settings.json"), key: "context_servers" }
  ];
}
function parseJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
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
function entries(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  return Object.entries(obj).filter(([, e]) => e && typeof e === "object" && e.disabled !== true);
}
function normalize(e) {
  const cmd = e.command;
  if (cmd && typeof cmd === "object") {
    const z = cmd;
    return { command: typeof z.path === "string" ? z.path : void 0, args: Array.isArray(z.args) ? z.args : void 0 };
  }
  return { command: typeof cmd === "string" ? cmd : void 0, args: Array.isArray(e.args) ? e.args : void 0, url: e.url, serverUrl: e.serverUrl, httpUrl: e.httpUrl, type: e.type };
}
function readServers(cfg, cwd) {
  let data;
  try {
    data = parseJsonc(readFileSync(cfg.path, "utf8"));
  } catch {
    return [];
  }
  if (!data || typeof data !== "object") return [];
  const found = entries(data[cfg.key]);
  if (cfg.claudeCode) {
    const projects = data.projects;
    found.push(...entries(projects?.[cwd]?.mcpServers));
  }
  return found.map(([name, e]) => ({ client: cfg.client, name, entry: normalize(e) }));
}
function collect(o) {
  return findConfigs(o).filter((c) => !o.client || c.client === o.client).flatMap((c) => readServers(c, o.cwd)).map((s) => ({ client: s.client, name: s.name, item: identify(s.entry) }));
}

// src/entry.ts
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
function isMain(metaUrl) {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    return false;
  }
}

// src/report.ts
var RANK = { ok: 0, info: 1, warn: 2, bad: 3 };
var MAX_LINES = 3;
function link(r) {
  if (!r.listing) return "";
  const base2 = r.listing.url.replace(/^https?:\/\//, "");
  return /tool|check/.test(r.notes[0] ?? "") ? `${base2}/checks` : base2;
}
function summarize(local, results) {
  const flagged = results.map((r, i) => ({ r, name: local[i]?.name ?? "?" })).filter((x) => !!x.r && RANK[x.r.level] >= RANK.warn).sort((a, b) => RANK[b.r.level] - RANK[a.r.level]);
  const level = results.reduce((m, r) => r && RANK[r.level] > RANK[m] ? r.level : m, "ok");
  const lines = flagged.slice(0, MAX_LINES).map(({ r, name }) => `${name}: ${r.notes[0] ?? r.level}  ${link(r)}`.trimEnd());
  if (flagged.length > MAX_LINES) lines.push(`\u2026and ${flagged.length - MAX_LINES} more: run npx @hosted-mcp/doctor`);
  return { level, count: flagged.length, lines };
}

// src/hook.ts
var DAY = 864e5;
var PENDING_MS = 10 * 6e4;
var cachePath = (home) => join2(home, ".cache", "hostedmcp", "doctor.json");
function readCache(home) {
  try {
    const c = JSON.parse(readFileSync2(cachePath(home), "utf8"));
    return c && typeof c === "object" && !Array.isArray(c) ? c : {};
  } catch {
    return {};
  }
}
function writeCache(home, cache) {
  const p = cachePath(home);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache));
  renameSync(tmp, p);
}
function message(s) {
  if (!s || s.count === 0 || s.lines.length === 0) return "";
  const head = `HostedMCP: ${s.count} of your MCP servers need${s.count === 1 ? "s" : ""} a look`;
  return JSON.stringify({ systemMessage: [head, ...s.lines.map((l) => `  ${l}`)].join("\n") });
}
function runHook(o) {
  if (o.env.HOSTEDMCP_DOCTOR === "off") return "";
  try {
    const cache = readCache(o.home);
    const entry = cache[o.cwd] ?? {};
    const fresh = entry.at !== void 0 && o.now - entry.at < DAY;
    const pending = entry.pendingAt !== void 0 && o.now - entry.pendingAt < PENDING_MS;
    if (!fresh && !pending) {
      cache[o.cwd] = { ...entry, pendingAt: o.now };
      writeCache(o.home, cache);
      o.spawnRefresh();
    }
    return message(entry.summary);
  } catch {
    return "";
  }
}
async function refresh(o) {
  const installed = collect({ home: o.home, cwd: o.cwd, platform: o.platform, appData: o.env.APPDATA });
  const sent = installed.filter((s) => s.item);
  let summary = { level: "ok", count: 0, lines: [] };
  if (sent.length) {
    const res = await check(sent.map((s) => s.item), { client: "claude-code", timeoutMs: 5e3, fetch: o.fetch });
    if (!res) return;
    summary = summarize(sent, res.results);
  }
  const cache = readCache(o.home);
  cache[o.cwd] = { at: o.now, summary };
  writeCache(o.home, cache);
}
var self = fileURLToPath2(import.meta.url);
if (isMain(import.meta.url)) {
  const home = homedir();
  const env = process.env;
  if (process.argv[2] === "--refresh") {
    const cwd = process.argv[3] ?? process.cwd();
    refresh({ home, cwd, now: Date.now(), platform: process.platform, env }).then(
      () => process.exit(0),
      () => process.exit(0)
    );
  } else {
    const cwd = env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const out = runHook({
      home,
      cwd,
      now: Date.now(),
      env,
      // An error handler, or a failed spawn would end the hook with a stack trace; windowsHide: no console window.
      spawnRefresh: () => spawn(process.execPath, [self, "--refresh", cwd], { detached: true, stdio: "ignore", env, windowsHide: true }).on("error", () => {
      }).unref()
    });
    if (out) process.stdout.write(`${out}
`);
  }
}
export {
  cachePath,
  message,
  refresh,
  runHook
};
