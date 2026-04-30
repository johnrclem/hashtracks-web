import { createHash } from "crypto";

// Stable JSON stringify: keys sorted recursively so the same logical
// object always produces the same string regardless of key order.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort((a, b) => a.localeCompare(b));
  const parts = keys.map(
    (k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`,
  );
  return `{${parts.join(",")}}`;
}

/**
 * SHA-256 fingerprint of `Source.config`, used as the regime-boundary
 * key in health-check baselines (#1115). Sources without a config
 * (STATIC_SCHEDULE, MANUAL, etc.) get a stable sentinel hash.
 */
export function computeConfigHash(config: unknown): string {
  const canonical = config == null ? "null" : stableStringify(config);
  return createHash("sha256").update(canonical).digest("hex");
}
