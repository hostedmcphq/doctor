import { describe, expect, it } from "vitest";
import { exitCode, summarize } from "../src/report.js";
import type { DoctorResult } from "../src/types.js";

const res = (level: DoctorResult["level"], notes: string[], name = "x"): DoctorResult => ({ index: 0, level, status: "match", listing: { owner: "o", name, title: name, url: `https://hostedmcp.org/servers/o/${name}` }, notes });
const local = (name: string) => ({ client: "cursor", name, item: { kind: "npm" as const, id: name } });

describe("summarize", () => {
  it("silent when all ok or info", () => {
    expect(summarize([local("a"), local("b")], [res("ok", []), res("info", ["1.3.0 available"])]).lines).toEqual([]);
  });

  it("bad first, links to /checks for tool notes, at most 3 lines", () => {
    const s = summarize(
      ["a", "b", "c", "d", "e"].map(local),
      [res("warn", ["2 tools changed this week"], "a"), res("bad", ["not responding since 17 Nov"], "b"), res("warn", ["checks score 40/100"], "c"), res("bad", ["archived"], "d"), res("ok", [], "e")],
    );
    expect(s.level).toBe("bad");
    expect(s.count).toBe(4);
    expect(s.lines).toEqual([
      "b: not responding since 17 Nov  hostedmcp.org/servers/o/b",
      "d: archived  hostedmcp.org/servers/o/d",
      "a: 2 tools changed this week  hostedmcp.org/servers/o/a/checks",
      "…and 1 more: run npx @hosted-mcp/doctor",
    ]);
  });

  it("exit code 2 when any bad, 1 for warn, 0 otherwise", () => {
    expect(exitCode([res("ok", []), res("bad", ["x"])])).toBe(2);
    expect(exitCode([res("info", []), res("warn", ["x"])])).toBe(1);
    expect(exitCode([res("info", [])])).toBe(0);
  });
});
