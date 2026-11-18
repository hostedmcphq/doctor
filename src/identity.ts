/**
 * What identifies an installed MCP server to the directory (docs/09 §4.5.3 in the HostedMCP monorepo): a package
 * name and version, or for a remote server its host and the SHA-256 of normUrl(url). Nothing else of the entry is
 * read: not env, headers, other arguments, paths, or the name the user gave the server.
 */
import { sha256Hex } from "./hash.js";
import type { DoctorItem, ServerEntry } from "./types.js";

/** Same as normUrl in the monorepo (shared-ts/schemas): lowercase host with port, path without trailing slashes. */
export function normUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return `${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}`;
}

function publicHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "");
  if (!name.includes(".") || /^\[|^\d+\.\d+\.\d+\.\d+$/.test(name)) return false;
  return !/(^|\.)(localhost|local|internal|lan|home)$/.test(name);
}

function remote(url: string): DoctorItem | null {
  const norm = normUrl(url);
  if (!norm) return null;
  const host = norm.split("/")[0]!;
  return publicHost(host) ? { kind: "remote", host, hash: sha256Hex(norm) } : null;
}

const base = (cmd: string) => cmd.split(/[\\/]/).pop()!.replace(/\.(cmd|exe|bat)$/i, "").toLowerCase();
const localish = (spec: string) => /^(\.|\/|~|[a-z]:\\)|:\/\/|^(git|file|link|github):/i.test(spec);
const versionish = (v: string | undefined) => (v && /^v?\d[\w.+-]*$/.test(v) ? v.replace(/^v/, "") : undefined);

/** `@scope/name@1.2.3` or `name@1.2.3`; a tag such as `latest` gives no version. */
function npmSpec(spec: string): DoctorItem | null {
  if (localish(spec)) return null;
  const at = spec.lastIndexOf("@");
  const [id, v] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, undefined];
  if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(id)) return null;
  const version = versionish(v);
  return version ? { kind: "npm", id, version } : { kind: "npm", id };
}

/** `name[extra]==1.0`, `name@1.0` or `name`; ranges give no version. */
function pypiSpec(spec: string): DoctorItem | null {
  if (localish(spec)) return null;
  const m = spec.match(/^([A-Za-z0-9][\w.-]*)(\[[^\]]*\])?(?:(==|@)([^,;\s]+))?$/);
  if (!m) return null;
  const version = versionish(m[4]);
  return version ? { kind: "pypi", id: m[1]!, version } : { kind: "pypi", id: m[1]! };
}

const DOCKER_VALUE_FLAGS = new Set(["-e", "--env", "-v", "--volume", "--name", "-p", "--publish", "--network", "--net", "--mount", "-w", "--workdir", "-u", "--user", "--entrypoint", "--platform", "--env-file", "-l", "--label", "--add-host", "--cpus", "-m", "--memory", "--pull", "--restart", "-h", "--hostname"]);

function ociImage(args: string[]): DoctorItem | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (DOCKER_VALUE_FLAGS.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    const ref = a.replace(/@sha256:[0-9a-f]{64}$/, "");
    const slash = ref.lastIndexOf("/");
    const colon = ref.lastIndexOf(":");
    const [id, tag] = colon > slash ? [ref.slice(0, colon), ref.slice(colon + 1)] : [ref, undefined];
    if (!/^[a-z0-9][\w./-]*$/.test(id)) return null;
    const version = tag && tag !== "latest" ? tag : undefined;
    return version ? { kind: "oci", id, version } : { kind: "oci", id };
  }
  return null;
}

const REMOTE_WRAPPERS = new Set(["mcp-remote", "@modelcontextprotocol/mcp-remote", "supergateway"]);

/** First argument that is not a flag; flags that take a value skip it. */
function firstSpec(args: string[], valueFlags: Set<string>): { spec: string; rest: string[] } | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valueFlags.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("-")) continue;
    return { spec: a, rest: args.slice(i + 1) };
  }
  return null;
}

export function identify(entry: ServerEntry & { serverUrl?: string; httpUrl?: string }): DoctorItem | null {
  const url = entry.url ?? entry.serverUrl ?? entry.httpUrl;
  if (typeof url === "string" && url) return remote(url);
  if (typeof entry.command !== "string" || !entry.command) return null;
  let cmd = base(entry.command);
  let args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : [];
  // Windows configs: `cmd /c npx -y pkg`.
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
    const first = pkgFlag >= 0 ? { spec: args[pkgFlag + 1] ?? "", rest: [] } : firstSpec(args, new Set(["--registry", "--cache"]));
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
    const first = firstSpec(args, new Set(["--with", "--python", "-p", "--index-url", "--index"]));
    return first ? pypiSpec(first.spec) : null;
  }
  if ((cmd === "docker" || cmd === "podman") && args[0] === "run") return ociImage(args.slice(1));
  return null;
}
