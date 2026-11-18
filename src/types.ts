/**
 * Request and response of POST https://api.hostedmcp.org/v1/doctor. Copied from the HostedMCP monorepo
 * (shared-ts/schemas, DoctorItem / DoctorResponse); test/fixtures/contract.json is the same file in both repos.
 */
export type DoctorItem = { kind: "remote"; host: string; hash: string } | { kind: "npm" | "pypi" | "oci"; id: string; version?: string };

export type DoctorLevel = "ok" | "info" | "warn" | "bad";

export interface DoctorResult {
  index: number;
  level: DoctorLevel;
  status: "match" | "ambiguous" | "unknown";
  listing?: { owner: string; name: string; title: string; url: string };
  candidates?: { owner: string; name: string; url: string }[];
  live?: { state: "up" | "gated" | "error" | "down"; since: number } | null;
  score?: number | null;
  highFails?: string[];
  toolChanges7d?: { added: number; changed: number; removed: number };
  install?: { ok: boolean; version: string } | null;
  latestVersion?: string | null;
  archived?: boolean;
  alternatives?: { owner: string; name: string; url: string; score: number }[];
  notes: string[];
}

export interface DoctorResponse {
  results: DoctorResult[];
  checkedAt: string;
}

/** One server entry of a client config, as written there (only these fields are ever read). */
export interface ServerEntry {
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
}
