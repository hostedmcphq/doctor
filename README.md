# HostedMCP Doctor

Checks the MCP servers you have installed against the [HostedMCP directory](https://hostedmcp.org) and tells you when one needs a look:

- the remote endpoint is not responding (three failed liveness checks in a row) or returns errors;
- the latest [automated checks](https://hostedmcp.org/about/verification) found a high-severity problem;
- a tool changed or disappeared this week while the version you run stayed the same;
- our test runner could not install or start the exact version you use;
- the project is archived, or its checks score is low.

It also mentions newer versions. When nothing is wrong, it stays quiet.

## Claude Code plugin

```
/plugin marketplace add hosted-mcp/doctor
/plugin install hostedmcp@hosted-mcp
```

Once a day, at the start of a session, the plugin checks your servers in the background and shows at most three lines when one needs a look. It never delays the session. Ask Claude to "check my MCP servers" for the full report. The plugin also adds the HostedMCP directory as an MCP server.

## Command line

```
npx @hosted-mcp/doctor            # table
npx @hosted-mcp/doctor --json     # machine-readable
npx @hosted-mcp/doctor --client cursor
```

Exit code 0 when everything is fine, 1 for a warning, 2 for a problem, so it can run in CI.

It reads the MCP configs of Claude Code, Claude Desktop, Cursor, VS Code, Gemini CLI, Windsurf, Cline and Zed.

## What it sends

Only what it needs to look a server up, to `https://api.hostedmcp.org/v1/doctor`:

- for a package (npx, uvx, pipx, docker): its name and version;
- for a remote server: its host name and the SHA-256 of its host and path. The address itself never leaves your computer, so a key inside a URL stays private.

Never sent: environment variables, headers, tokens, other arguments, file paths, the names you gave your servers. Servers that run a local script are not sent at all. HostedMCP counts which listed servers matched, and nothing about servers that did not. See the [privacy policy](https://hostedmcp.org/privacy).

Turn it off with `HOSTEDMCP_DOCTOR=off`.

## Develop

```
npm install
npm test
npm run build   # dist/ and plugin/dist/
```

`test/fixtures/contract.json` is the same file as `backend/test/fixtures/doctor-contract.json` in the HostedMCP monorepo; both test suites check it, so an API change that breaks the client fails a test.

MIT licensed.
