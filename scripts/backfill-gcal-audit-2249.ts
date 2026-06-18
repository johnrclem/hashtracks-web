/**
 * One-shot canonical backfill for the GCal audit fixes in PR #2249.
 *
 * Why this is needed: the adapter + per-source config fixes are correct for
 * NEW RawEvents (verified: fresh raws carry the right values), but the merge
 * pipeline intentionally PRESERVES existing canonical values, so a plain
 * re-scrape does not retroactively fix already-stored events:
 *   - resolveUpdatedTitle (merge.ts, #2233) keeps an existing non-placeholder
 *     title and refuses to replace it with a synthesized default → "Kimchi #"
 *     sticks even though a fresh "Kimchi H3 Trail" raw now exists.
 *   - hares/location that the adapter now drops resolve to `undefined`
 *     ("no signal" → merge preserves), not `null` ("explicit clear"), and the
 *     unchanged-fingerprint raw is deduped (skipped) — so the canonical keeps
 *     the stale "Notes:" / "special location" / title-as-location value.
 *
 * This script clears that historical backlog directly. It STICKS because the
 * merge won't re-clobber these fields once corrected. title/haresText/cost/
 * locationName are NOT part of the RawEvent fingerprint, so rewriting them
 * never disturbs dedup.
 *
 * Scoped & safe: each section matches an exact stale value + the owning kennel,
 * uses an optimistic value guard (updateMany WHERE includes the old value), and
 * is idempotent (a re-run matches 0 rows).
 *
 * Run (Railway proxy uses a self-signed cert; this worktree has no .env):
 *   Dry-run: DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-gcal-audit-2249.ts
 *   Apply:   DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/backfill-gcal-audit-2249.ts --apply
 */
import { runOneShot } from "./lib/one-shot";

const SAMPLE = 8;

void runOneShot(async ({ prisma, apply }) => {
  // ── #2218 Kimchi — title "Kimchi #" → "Kimchi H3 Trail" ──────────────────
  {
    const rows = await prisma.event.findMany({
      where: { title: "Kimchi #", eventKennels: { some: { kennel: { kennelCode: "kimchi-h3" } } } },
      select: { id: true, dateUtc: true },
      orderBy: { date: "asc" },
    });
    console.log(`\n#2218 Kimchi title "Kimchi #" → "Kimchi H3 Trail": ${rows.length} event(s)`);
    if (apply && rows.length) {
      const res = await prisma.event.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, title: "Kimchi #" },
        data: { title: "Kimchi H3 Trail" },
      });
      console.log(`   ✏️  updated ${res.count}`);
    }
  }

  // ── #2213 Thirstday — haresText "Notes:" → null ──────────────────────────
  {
    const rows = await prisma.event.findMany({
      where: { haresText: "Notes:", eventKennels: { some: { kennel: { kennelCode: "th3" } } } },
      select: { id: true },
    });
    console.log(`\n#2213 Thirstday haresText "Notes:" → null: ${rows.length} event(s)`);
    if (apply && rows.length) {
      const res = await prisma.event.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, haresText: "Notes:" },
        data: { haresText: null },
      });
      console.log(`   ✏️  updated ${res.count}`);
    }
  }

  // ── #2235 SEH3 — haresText "special location" → null ─────────────────────
  {
    const rows = await prisma.event.findMany({
      where: { haresText: "special location", eventKennels: { some: { kennel: { kennelCode: "seh3-wa" } } } },
      select: { id: true, title: true },
    });
    console.log(`\n#2235 SEH3 haresText "special location" → null: ${rows.length} event(s)`);
    rows.slice(0, SAMPLE).forEach((r) => console.log(`   - ${r.title}`));
    if (apply && rows.length) {
      const res = await prisma.event.updateMany({
        where: { id: { in: rows.map((r) => r.id) }, haresText: "special location" },
        data: { haresText: null },
      });
      console.log(`   ✏️  updated ${res.count}`);
    }
  }

  // ── #2231 Larryville — locationName == title (verbatim) → null ───────────
  {
    const candidates = await prisma.event.findMany({
      where: { locationName: { not: null }, eventKennels: { some: { kennel: { kennelCode: "lh3-ks" } } } },
      select: { id: true, title: true, locationName: true },
    });
    const dupes = candidates.filter(
      (e) =>
        !!e.title &&
        !!e.locationName &&
        e.title.trim().toLowerCase() === e.locationName.trim().toLowerCase(),
    );
    console.log(`\n#2231 Larryville locationName == title → null: ${dupes.length} event(s)`);
    dupes.slice(0, SAMPLE).forEach((r) => console.log(`   - ${r.title}`));
    if (apply) {
      let n = 0;
      for (const e of dupes) {
        const res = await prisma.event.updateMany({
          where: { id: e.id, locationName: e.locationName },
          data: { locationName: null },
        });
        n += res.count;
      }
      if (dupes.length) console.log(`   ✏️  updated ${n}`);
    }
  }

  // ── #2217 LDS — residual garbled cost "\(5..." → "$5..." (scrape outliers) ─
  {
    const candidates = await prisma.event.findMany({
      where: { cost: { not: null }, eventKennels: { some: { kennel: { kennelCode: "lds-h3" } } } },
      select: { id: true, cost: true, dateUtc: true },
      orderBy: { date: "asc" },
    });
    const garbled = candidates.filter((e) => (e.cost ?? "").includes("\\("));
    console.log(`\n#2217 LDS garbled cost "\\(5..." → "$5...": ${garbled.length} event(s)`);
    garbled.slice(0, SAMPLE).forEach((r) => console.log(`   - ${r.cost}`));
    if (apply) {
      let n = 0;
      for (const e of garbled) {
        const fixed = (e.cost ?? "").replaceAll("\\(", "$").replaceAll("\\)", "$");
        const res = await prisma.event.updateMany({
          where: { id: e.id, cost: e.cost },
          data: { cost: fixed },
        });
        n += res.count;
      }
      if (garbled.length) console.log(`   ✏️  updated ${n}`);
    }
  }

  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
