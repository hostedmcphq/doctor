import type { DoctorItem, DoctorResponse, DoctorResult } from "./types.js";

export const API = "https://api.hostedmcp.org/v1/doctor";
const MAX = 50;
const key = (i: DoctorItem) => JSON.stringify(i);

export interface CheckOptions {
  api?: string;
  timeoutMs?: number;
  client?: string;
  fetch?: typeof globalThis.fetch;
}

/**
 * Checks items against the directory: duplicates sent once, at most 50 per call. Results come back in the order of
 * `items` (one per item). null when any call fails or the network is down: the caller then says nothing.
 */
export async function check(items: DoctorItem[], o: CheckOptions = {}): Promise<DoctorResponse | null> {
  const unique = [...new Map(items.map((i) => [key(i), i])).values()];
  const f = o.fetch ?? globalThis.fetch;
  const byKey = new Map<string, DoctorResult>();
  let checkedAt = new Date().toISOString();
  try {
    for (let i = 0; i < unique.length; i += MAX) {
      const chunk = unique.slice(i, i + MAX);
      const res = await f(o.api ?? API, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "hosted-mcp-doctor/0.1" },
        body: JSON.stringify(o.client ? { client: o.client, servers: chunk } : { servers: chunk }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as DoctorResponse;
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
    results: items.map((it, index) => ({ ...(byKey.get(key(it)) ?? { level: "ok" as const, status: "unknown" as const, notes: [] }), index })),
  };
}
