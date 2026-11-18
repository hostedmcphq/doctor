/**
 * Claude Code SessionStart hook (docs/09 §4.5.5 in the HostedMCP monorepo). It never waits on the network: it reads
 * the cache, prints a systemMessage only when a server is at warn or bad, and when the cache is older than a day
 * starts a detached `--refresh` process whose result shows at the next session. Offline or any error: silent.
 * Off with HOSTEDMCP_DOCTOR=off.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check } from "./api.js";
import { collect } from "./configs.js";
import { summarize, type Summary } from "./report.js";

const DAY = 86400_000;
/** A refresh started this recently is not started again (several sessions opening at once). */
const PENDING_MS = 10 * 60_000;

interface Entry {
  at?: number;
  summary?: Summary;
  pendingAt?: number;
}
type Cache = Record<string, Entry>;

export const cachePath = (home: string) => join(home, ".cache", "hostedmcp", "doctor.json");

function readCache(home: string): Cache {
  try {
    const c = JSON.parse(readFileSync(cachePath(home), "utf8")) as unknown;
    return c && typeof c === "object" && !Array.isArray(c) ? (c as Cache) : {};
  } catch {
    return {};
  }
}

function writeCache(home: string, cache: Cache): void {
  const p = cachePath(home);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(cache));
  renameSync(tmp, p);
}

export function message(s: Summary | undefined): string {
  if (!s || s.count === 0 || s.lines.length === 0) return "";
  const head = `HostedMCP: ${s.count} of your MCP servers need${s.count === 1 ? "s" : ""} a look`;
  return JSON.stringify({ systemMessage: [head, ...s.lines.map((l) => `  ${l}`)].join("\n") });
}

export interface HookOptions {
  home: string;
  cwd: string;
  now: number;
  env: Record<string, string | undefined>;
  spawnRefresh: () => void;
}

/** What the hook prints: "" or one JSON line with `systemMessage`. Never awaits anything. */
export function runHook(o: HookOptions): string {
  if (o.env.HOSTEDMCP_DOCTOR === "off") return "";
  try {
    const cache = readCache(o.home);
    const entry = cache[o.cwd] ?? {};
    const fresh = entry.at !== undefined && o.now - entry.at < DAY;
    const pending = entry.pendingAt !== undefined && o.now - entry.pendingAt < PENDING_MS;
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

export interface RefreshOptions {
  home: string;
  cwd: string;
  now: number;
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  fetch?: typeof globalThis.fetch;
}

/** Collects, checks (5 s), and stores the summary for `cwd`; on failure the previous entry stays. */
export async function refresh(o: RefreshOptions): Promise<void> {
  const installed = collect({ home: o.home, cwd: o.cwd, platform: o.platform, appData: o.env.APPDATA });
  const sent = installed.filter((s) => s.item);
  let summary: Summary = { level: "ok", count: 0, lines: [] };
  if (sent.length) {
    const res = await check(sent.map((s) => s.item!), { client: "claude-code", timeoutMs: 5_000, fetch: o.fetch });
    if (!res) return;
    summary = summarize(sent, res.results);
  }
  const cache = readCache(o.home);
  cache[o.cwd] = { at: o.now, summary };
  writeCache(o.home, cache);
}

// Entry point (plugin/dist/hook.mjs).
const self = fileURLToPath(import.meta.url);
if (process.argv[1] && fileURLToPath(new URL(`file://${process.argv[1]}`)) === self) {
  const home = homedir();
  const env = process.env;
  if (process.argv[2] === "--refresh") {
    const cwd = process.argv[3] ?? process.cwd();
    refresh({ home, cwd, now: Date.now(), platform: process.platform, env }).then(
      () => process.exit(0),
      () => process.exit(0),
    );
  } else {
    const cwd = env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const out = runHook({
      home,
      cwd,
      now: Date.now(),
      env,
      spawnRefresh: () => spawn(process.execPath, [self, "--refresh", cwd], { detached: true, stdio: "ignore", env }).unref(),
    });
    if (out) process.stdout.write(`${out}\n`);
  }
}
