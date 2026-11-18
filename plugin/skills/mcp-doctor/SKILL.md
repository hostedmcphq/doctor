---
name: mcp-doctor
description: Check the MCP servers the user has installed against the HostedMCP directory, and explain any problems. Use when the user asks to check, audit or troubleshoot their MCP servers, or after a "HostedMCP: … need a look" message at session start.
---

# MCP doctor

1. Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli.mjs" --json`. It reads the MCP configs of Claude Code, Claude Desktop, Cursor, VS Code, Gemini CLI, Windsurf, Cline and Zed, and sends only package names and versions (remote servers as host plus a hash) to hostedmcp.org.
2. For each server whose `result.level` is `bad` or `warn`, explain the notes in plain words and give its link (`result.listing.url`; add `/checks` for tool or check findings). Mention `info` items briefly, such as a newer version.
3. Offer a fix where there is one: a newer version, or one of `result.alternatives`. For the exact config, fetch `https://api.hostedmcp.org/v1/servers/{owner}/{name}/install?client=claude-code`.
4. Change nothing in the user's configuration without their explicit yes.

`sent: false` means the server runs a local command and was not checked. `status: "unknown"` means it is not in the directory. If the command reports it could not reach hostedmcp.org, say so and stop.
