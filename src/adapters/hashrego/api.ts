/**
 * Hash Rego kennel-events JSON client.
 *
 * Narrow-purpose fetcher for `/api/kennels/{slug}/events/`. Used by adapter.ts
 * Step 2b as the per-kennel-page fallback transport. This module does NOT
 * handle the global `/events` index or per-event detail endpoints.
 */

import { USER_AGENT } from "./constants";
import { safeFetch } from "../safe-fetch";

const BASE_URL = "https://hashrego.com";
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * `/api/kennels/{slug}/events/` list response item.
 * Fields verified via curl on 2026-04-08.
 */
export interface HashRegoKennelEvent {
  slug: string;
  event_name: string;
  host_kennel_slug: string;
  start_time: string; // ISO 8601 with timezone offset
  current_price: number | null;
  has_hares: boolean;
  opt_hares: string;
  is_over: boolean;
  rego_count: number;
  open_spots: number;
  creator: string;
  created: string;
  modified: string;
}

export type HashRegoApiErrorKind =
  | "auth"
  | "rate_limit"
  | "server"
  | "network"
  | "parse"
  | "not_found";

/**
 * Distinguish legitimate "no events for this kennel" (200 + `[]`) from API
 * failures. Callers record instances in `errorDetails.fetch` or
 * `errorDetails.parse` depending on `kind`.
 */
export class HashRegoApiError extends Error {
  constructor(
    public readonly slug: string,
    public readonly status: number,
    public readonly kind: HashRegoApiErrorKind,
    detail?: string,
    options?: { cause?: unknown },
  ) {
    super(
      `Hash Rego API ${kind} error for ${slug}: HTTP ${status}${detail ? ` — ${detail}` : ""}`,
      options,
    );
    this.name = "HashRegoApiError";
  }
}

// 4xx/5xx status → error kind mapping. Anything >= 500 falls through to "server".
const STATUS_KIND: Record<number, HashRegoApiErrorKind> = {
  401: "auth",
  403: "auth",
  404: "not_found",
  429: "rate_limit",
};

/**
 * Fetch a kennel's events from the Hash Rego JSON API.
 *
 * Strict error semantics:
 *   - 200 + valid JSON array → return array (may be empty)
 *   - 200 + malformed/non-array JSON → throws HashRegoApiError("parse")
 *   - 401 / 403 → throws HashRegoApiError("auth")
 *   - 404 → throws HashRegoApiError("not_found") — a configured slug must exist;
 *     silently returning [] would let the reconciler cancel events as stale
 *   - 429 → throws HashRegoApiError("rate_limit")
 *   - 5xx → throws HashRegoApiError("server")
 *   - Network / DNS / abort → throws HashRegoApiError("network")
 *
 * The per-call timeout is passed in by the batched-concurrent caller so it
 * can shrink timeouts as the Step 2b budget runs out.
 */
export async function fetchKennelEvents(
  kennelSlug: string,
  opts: { timeoutMs: number } = { timeoutMs: DEFAULT_TIMEOUT_MS },
): Promise<HashRegoKennelEvent[]> {
  const url = `${BASE_URL}/api/kennels/${encodeURIComponent(kennelSlug)}/events/`;
  let res: Response;
  try {
    res = await safeFetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    throw new HashRegoApiError(kennelSlug, 0, "network", String(err), { cause: err });
  }

  if (!res.ok) {
    await drain(res);
    const kind = STATUS_KIND[res.status] ?? "server";
    const detail = kind === "server" ? `unexpected HTTP ${res.status}` : undefined;
    throw new HashRegoApiError(kennelSlug, res.status, kind, detail);
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    throw new HashRegoApiError(kennelSlug, 200, "parse", `invalid JSON: ${err}`, { cause: err });
  }
  if (!Array.isArray(parsed)) {
    throw new HashRegoApiError(
      kennelSlug,
      200,
      "parse",
      `expected array, got ${typeof parsed}`,
    );
  }
  // Runtime shape validation happens row-by-row in apiToIndexEntry; per-row
  // failures surface as ParseError entries rather than failing the whole call.
  return parsed as HashRegoKennelEvent[];
}

/** Drain and release a Response body we don't intend to consume. */
async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }
}
