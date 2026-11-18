import type { DoctorItem, DoctorLevel, DoctorResult } from "./types.js";

const RANK: Record<DoctorLevel, number> = { ok: 0, info: 1, warn: 2, bad: 3 };
const MAX_LINES = 3;

export interface Summary {
  level: DoctorLevel;
  /** Servers at warn or bad. */
  count: number;
  /** At most 3 finding lines, then "…and N more". Empty when nothing is warn or bad. */
  lines: string[];
}

/** hostedmcp.org link of a result, to /checks when the first note is about tools or checks. */
export function link(r: DoctorResult): string {
  if (!r.listing) return "";
  const base = r.listing.url.replace(/^https?:\/\//, "");
  return /tool|check/.test(r.notes[0] ?? "") ? `${base}/checks` : base;
}

/** `local[i]` and `results[i]` describe the same server. */
export function summarize(local: { name: string; item: DoctorItem | null }[], results: (DoctorResult | null)[]): Summary {
  const flagged = results
    .map((r, i) => ({ r, name: local[i]?.name ?? "?" }))
    .filter((x): x is { r: DoctorResult; name: string } => !!x.r && RANK[x.r.level] >= RANK.warn)
    .sort((a, b) => RANK[b.r.level] - RANK[a.r.level]);
  const level = results.reduce<DoctorLevel>((m, r) => (r && RANK[r.level] > RANK[m] ? r.level : m), "ok");
  const lines = flagged.slice(0, MAX_LINES).map(({ r, name }) => `${name}: ${r.notes[0] ?? r.level}  ${link(r)}`.trimEnd());
  if (flagged.length > MAX_LINES) lines.push(`…and ${flagged.length - MAX_LINES} more: run npx @hosted-mcp/doctor`);
  return { level, count: flagged.length, lines };
}

export function exitCode(results: (DoctorResult | null)[]): number {
  const top = results.reduce((m, r) => Math.max(m, r ? RANK[r.level] : 0), 0);
  return top === RANK.bad ? 2 : top === RANK.warn ? 1 : 0;
}
