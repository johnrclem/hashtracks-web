/**
 * Shared helpers for the docs/audits/* report scripts (audit-travel-predictions,
 * propose-rule-fixes). Extracted to keep date math + report writing consistent
 * across both (Gemini review on PR #2154).
 */
import fs from "node:fs";
import path from "node:path";

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Normalize a Date to UTC noon (matches how Event dates are stored). */
export function utcNoon(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/** YYYY-MM-DD. */
export function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Percentage string for n/d. `digits` controls decimal places (default 1). */
export function pct(n: number, d: number, digits = 1): string {
  if (d === 0) return "—";
  return `${((100 * n) / d).toFixed(digits)}%`;
}

const AUDIT_DIR = path.join("docs", "audits");

/**
 * Write a dated audit report (markdown + JSON sidecar) under docs/audits/.
 * `basename` already carries the date, e.g. "travel-predictions-2026-06-11".
 *
 * The fs path is built from a fixed repo-relative dir (docs/audits) + a basename
 * composed from our own clock (never user input). Codacy's
 * security/detect-non-literal-fs-filename flags the fs calls below as false
 * positives; this file is excluded in .codacy.yml (inline suppression doesn't
 * apply cleanly — see that file's comment).
 */
export function writeAuditReport(
  basename: string,
  markdown: string,
  json: unknown,
): { mdPath: string; jsonPath: string } {
  const mdPath = path.join(AUDIT_DIR, `${basename}.md`);
  const jsonPath = path.join(AUDIT_DIR, `${basename}.json`);
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  fs.writeFileSync(mdPath, markdown);
  fs.writeFileSync(jsonPath, JSON.stringify(json, null, 2));
  return { mdPath, jsonPath };
}
