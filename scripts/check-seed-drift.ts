/**
 * Read-only report: where prod differs from prisma/seed-data, judged by the
 * seed's own update rules (prisma/seed.ts). Seed changes reach prod only
 * through a data migration (Vercel never runs `db seed`), so anything this
 * prints is either a migration that was never written or a prod change that
 * was never seeded.
 *
 *   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/check-seed-drift.ts [--json]
 *
 * Runs every query in a read-only transaction and never writes.
 *
 * Sections:
 *   missingSources          seeded source with no prod row (needs a migration)
 *   fieldDrift              trust (seed higher), config, url, scrapeDays, scrapeFreq or enabled differ
 *   missingLinks            seeded kennelCodes not linked in prod
 *   extraLinks              prod links the seed would prune on its next run
 *   slugDrift               kennelSlugMap slug differs from SourceKennel.externalSlug
 *   missingKennels          seeded kennel with no prod row
 *   missingAliases          seeded alias missing in prod
 *   prodOnlyEnabledSources  enabled prod source the seed doesn't know (seed it or retire it)
 *
 * A disabled legacy row (a source whose type changed) can show missing links;
 * that is harmless while it stays disabled.
 */
import "dotenv/config";
import { createScriptPool } from "./lib/db-pool";
import { SOURCES } from "../prisma/seed-data/sources";
import { KENNELS } from "../prisma/seed-data/kennels";
import { KENNEL_ALIASES } from "../prisma/seed-data/aliases";

/** Same key-sorted JSON the seed uses to decide a config changed. */
function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

interface SeedSource {
  name: string;
  type: string;
  url?: string;
  trustLevel?: number;
  scrapeFreq?: string;
  scrapeDays?: number;
  enabled?: boolean;
  config?: unknown;
  kennelCodes?: string[];
  kennelSlugMap?: Record<string, string>;
}

async function main() {
  const pool = createScriptPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const sources = (await client.query(
      `SELECT id, name, type::text AS type, url, "trustLevel", "scrapeFreq", "scrapeDays", enabled, config FROM "Source"`,
    )).rows;
    const kennels = (await client.query(`SELECT id, "kennelCode" FROM "Kennel"`)).rows;
    const links = (await client.query(`SELECT "sourceId", "kennelId", "externalSlug" FROM "SourceKennel"`)).rows;
    const aliases = (await client.query(`SELECT "kennelId", lower(alias) AS alias FROM "KennelAlias"`)).rows;
    await client.query("ROLLBACK");

    const kennelIdByCode = new Map<string, string>(kennels.map((k) => [k.kennelCode, k.id]));
    const codeByKennelId = new Map<string, string>(kennels.map((k) => [k.id, k.kennelCode]));
    const report: Record<string, unknown[]> = {
      missingSources: [], fieldDrift: [], missingLinks: [], extraLinks: [], slugDrift: [],
      missingKennels: [], missingAliases: [], prodOnlyEnabledSources: [],
    };

    const seeded = new Set<string>();
    for (const s of SOURCES as SeedSource[]) {
      seeded.add(`${s.name}::${s.type}`);
      const p = sources.find((r) => r.name === s.name && r.type === s.type);
      if (!p) { report.missingSources.push({ name: s.name, type: s.type, kennelCodes: s.kennelCodes }); continue; }

      const drift: Record<string, unknown> = {};
      if (s.trustLevel && s.trustLevel > (p.trustLevel ?? 0)) drift.trustLevel = { prod: p.trustLevel, seed: s.trustLevel };
      if (s.config !== undefined && stableStringify(s.config) !== stableStringify(p.config)) drift.config = "differs";
      for (const f of ["url", "scrapeDays", "scrapeFreq"] as const) {
        if (s[f] && s[f] !== p[f]) drift[f] = { prod: p[f], seed: s[f] };
      }
      if (s.enabled !== undefined && s.enabled !== p.enabled) drift.enabled = { prod: p.enabled, seed: s.enabled };
      if (Object.keys(drift).length > 0) report.fieldDrift.push({ name: s.name, ...drift });

      const own = links.filter((l) => l.sourceId === p.id);
      const linkedCodes = new Set(own.map((l) => codeByKennelId.get(l.kennelId)));
      for (const code of s.kennelCodes ?? []) {
        if (!linkedCodes.has(code)) report.missingLinks.push({ source: s.name, kennel: code, prodEnabled: p.enabled });
      }
      for (const l of own) {
        const code = codeByKennelId.get(l.kennelId);
        if (code && !(s.kennelCodes ?? []).includes(code)) report.extraLinks.push({ source: s.name, kennel: code });
      }
      for (const [code, slug] of Object.entries(s.kennelSlugMap ?? {})) {
        const l = own.find((x) => codeByKennelId.get(x.kennelId) === code);
        if (l && l.externalSlug !== slug) report.slugDrift.push({ source: s.name, kennel: code, prod: l.externalSlug, seed: slug });
      }
    }
    for (const r of sources) {
      if (r.enabled && !seeded.has(`${r.name}::${r.type}`)) report.prodOnlyEnabledSources.push({ name: r.name, type: r.type });
    }
    for (const k of KENNELS) {
      if (!kennelIdByCode.has(k.kennelCode)) report.missingKennels.push({ kennelCode: k.kennelCode });
    }
    for (const [code, list] of Object.entries(KENNEL_ALIASES)) {
      const id = kennelIdByCode.get(code);
      if (!id) continue;
      const have = new Set(aliases.filter((a) => a.kennelId === id).map((a) => a.alias));
      for (const alias of list) if (!have.has(alias.toLowerCase())) report.missingAliases.push({ kennel: code, alias });
    }

    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      for (const [section, rows] of Object.entries(report)) {
        console.log(`${section}: ${rows.length}`);
        for (const row of rows) console.log(`  ${JSON.stringify(row)}`);
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
