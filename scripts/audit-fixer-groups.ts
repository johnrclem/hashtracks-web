/**
 * Groups open audit defects by the adapter behind each kennel, for the audit fixer's batch key
 * ("root cause / adapter", docs/ops/audit-fixer-task.md, Phase C).
 *
 * Reads `gh issue list --json number,createdAt,labels` output on stdin. Each issue's `kennel:<code>`
 * label maps to the kennel's enabled, non-static sources in `prisma/seed-data/sources.ts`: a shared
 * adapter is keyed by its source type (GOOGLE_CALENDAR, HARRIER_CENTRAL, …), a site-specific HTML
 * scraper by its registry name. A kennel with several adapters lists its issues under each; triage
 * decides which one is the cause. Prints one line per group, the group whose oldest defect has
 * waited longest first: `<adapter> <oldest date> <issue numbers, oldest first>`.
 *
 * Reads seed data and the adapter registry only; never the database.
 *
 *   gh issue list … --json number,createdAt,labels | npx tsx scripts/audit-fixer-groups.ts
 */
import { readFileSync } from "node:fs";

import { SOURCES } from "../prisma/seed-data/sources";
import { findHtmlAdapter } from "../src/adapters/registry";
import { parseKennelLabel } from "../src/lib/audit-labels";

interface Issue {
  number: number;
  createdAt: string;
  labels: Array<{ name: string }>;
}

const adaptersByKennel = new Map<string, Set<string>>();
for (const s of SOURCES as ReadonlyArray<{ type: string; url: string; enabled?: boolean; kennelCodes: readonly string[] }>) {
  if (s.enabled === false || s.type === "STATIC_SCHEDULE") continue;
  const key = s.type === "HTML_SCRAPER" ? (findHtmlAdapter(s.url) ?? "GenericHtmlAdapter") : s.type;
  for (const k of s.kennelCodes) {
    const set = adaptersByKennel.get(k) ?? new Set<string>();
    set.add(key);
    adaptersByKennel.set(k, set);
  }
}

const issues = JSON.parse(readFileSync(0, "utf8")) as Issue[];
const groups = new Map<string, Issue[]>();
for (const issue of issues) {
  const kennel = issue.labels.map((l) => parseKennelLabel(l.name)).find((code) => code !== null);
  const keys = kennel ? [...(adaptersByKennel.get(kennel) ?? ["no-source"])] : [`none:${issue.number}`];
  for (const key of keys) groups.set(key, [...(groups.get(key) ?? []), issue]);
}

const lines = [...groups.entries()]
  .map(([key, list]) => {
    const sorted = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { key, oldest: sorted[0].createdAt, numbers: sorted.map((i) => i.number) };
  })
  .sort((a, b) => a.oldest.localeCompare(b.oldest));
for (const g of lines) console.log(`${g.key} ${g.oldest.slice(0, 10)} ${g.numbers.join(" ")}`);
