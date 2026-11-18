import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** A temporary home and project directory with the given files (paths relative to home; `$cwd/` for the project). */
export function tempHome(files: Record<string, string | object>): { home: string; cwd: string } {
  const home = mkdtempSync(join(tmpdir(), "doctor-home-"));
  const cwd = join(home, "work", "proj");
  mkdirSync(cwd, { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    const p = rel.startsWith("$cwd/") ? join(cwd, rel.slice(5)) : join(home, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, typeof body === "string" ? body : JSON.stringify(body));
  }
  return { home, cwd };
}
