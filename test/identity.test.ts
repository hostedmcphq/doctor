import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../src/hash.js";
import { identify, normUrl } from "../src/identity.js";

const fx = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/contract.json"), "utf8")) as { normUrl: [string, string | null][] };

describe("identify (docs/09 §4.5.3)", () => {
  it("npm through npx, bunx, pnpm dlx and yarn dlx", () => {
    expect(identify({ command: "npx", args: ["-y", "pkg@1.2.0"] })).toEqual({ kind: "npm", id: "pkg", version: "1.2.0" });
    expect(identify({ command: "npx", args: ["-y", "@scope/pkg"] })).toEqual({ kind: "npm", id: "@scope/pkg" });
    expect(identify({ command: "npx", args: ["-y", "@scope/pkg@2.0.1", "--port", "3000"] })).toEqual({ kind: "npm", id: "@scope/pkg", version: "2.0.1" });
    expect(identify({ command: "bunx", args: ["pkg@1.0.0"] })).toEqual({ kind: "npm", id: "pkg", version: "1.0.0" });
    expect(identify({ command: "pnpm", args: ["dlx", "pkg"] })).toEqual({ kind: "npm", id: "pkg" });
    expect(identify({ command: "yarn", args: ["dlx", "@a/b@3.0.0"] })).toEqual({ kind: "npm", id: "@a/b", version: "3.0.0" });
    expect(identify({ command: "npx", args: ["-y", "pkg@latest"] })).toEqual({ kind: "npm", id: "pkg" });
    expect(identify({ command: "/usr/local/bin/npx", args: ["-y", "pkg"] })).toEqual({ kind: "npm", id: "pkg" });
    expect(identify({ command: "cmd", args: ["/c", "npx", "-y", "pkg@1.0.0"] })).toEqual({ kind: "npm", id: "pkg", version: "1.0.0" });
  });

  it("pypi through uvx and pipx", () => {
    expect(identify({ command: "uvx", args: ["pkg==1.0"] })).toEqual({ kind: "pypi", id: "pkg", version: "1.0" });
    expect(identify({ command: "uvx", args: ["mcp-server-fetch"] })).toEqual({ kind: "pypi", id: "mcp-server-fetch" });
    expect(identify({ command: "pipx", args: ["run", "pkg"] })).toEqual({ kind: "pypi", id: "pkg" });
    expect(identify({ command: "uvx", args: ["--from", "pkg[extra]==2.1", "cmd"] })).toEqual({ kind: "pypi", id: "pkg", version: "2.1" });
    expect(identify({ command: "uv", args: ["tool", "run", "pkg"] })).toEqual({ kind: "pypi", id: "pkg" });
  });

  it("oci through docker run, without env or volumes", () => {
    const r = identify({ command: "docker", args: ["run", "-i", "--rm", "-e", "TOKEN=x", "-v", "/home/me:/data", "ghcr.io/o/i:1.4", "--flag"] });
    expect(r).toEqual({ kind: "oci", id: "ghcr.io/o/i", version: "1.4" });
    expect(JSON.stringify(r)).not.toMatch(/TOKEN|home/);
    expect(identify({ command: "docker", args: ["run", "-i", "--rm", "--env", "A=b", "mcp/github"] })).toEqual({ kind: "oci", id: "mcp/github" });
    expect(identify({ command: "docker", args: ["run", "-i", "--rm", "img@sha256:" + "a".repeat(64)] })).toEqual({ kind: "oci", id: "img" });
  });

  it("local scripts and binaries are not sent", () => {
    expect(identify({ command: "node", args: ["./server.js"] })).toBeNull();
    expect(identify({ command: "/usr/local/bin/x" })).toBeNull();
    expect(identify({ command: "python", args: ["-m", "my_server"] })).toBeNull();
    expect(identify({ command: "npx", args: ["-y", "./local-pkg"] })).toBeNull();
    expect(identify({ command: "npx", args: ["-y", "/abs/path"] })).toBeNull();
    expect(identify({})).toBeNull();
  });

  it("remote: host and hash only", () => {
    const url = "https://user:pw@API.x.com/mcp/s/abc123/mcp?key=1";
    const r = identify({ url });
    expect(r).toEqual({ kind: "remote", host: "api.x.com", hash: sha256Hex("api.x.com/mcp/s/abc123/mcp") });
    expect(JSON.stringify(r)).not.toMatch(/abc123|key=|pw/);
    expect(identify({ type: "http", url: "https://h.example:8443/sse" })).toMatchObject({ kind: "remote", host: "h.example:8443" });
    expect(identify({ serverUrl: "https://w.example/mcp" } as never)).toMatchObject({ kind: "remote", host: "w.example" });
    expect(identify({ url: "http://localhost:3000/mcp" })).toBeNull();
    expect(identify({ url: "https://127.0.0.1/mcp" })).toBeNull();
  });

  it("mcp-remote and similar wrappers are treated as the remote they point to", () => {
    expect(identify({ command: "npx", args: ["-y", "mcp-remote", "https://mcp.acme.dev/sse"] })).toMatchObject({ kind: "remote", host: "mcp.acme.dev" });
  });

  it("normUrl matches the backend on every contract case", () => {
    for (const [input, out] of fx.normUrl) expect(normUrl(input), input).toBe(out);
  });
});
