import { createHash } from "node:crypto";

/** SHA-256 hex of a string (UTF-8) or bytes. */
export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * JSON with object keys sorted at every depth and no whitespace, so the same
 * value always hashes the same. `undefined` object members are dropped, as
 * JSON.stringify drops them.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Days between two `YYYY-MM-DD` dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

/** `YYYY-MM-DD` plus `n` days. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** The `YYYY-MM-DD` of a UTC-noon Date. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Median of a non-empty list of numbers. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
