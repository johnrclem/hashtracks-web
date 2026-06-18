/**
 * Targeted prod Source.config sync for #2214 + #2216.
 *
 * Vercel runs `prisma migrate deploy`, NOT `prisma db seed`, so edits to
 * `prisma/seed-data/sources.ts` never reach the prod `Source` rows on merge.
 * A full `db seed` would full-overwrite every Source.config and clobber other
 * concurrent source edits, so this script updates ONLY the two rows this change
 * owns, merging keys into the existing config rather than replacing it:
 *
 *   - #2214 Puget Sound H3 Hareline Sheet → trustLevel 7 (was 5), so the
 *     dedicated hareline out-trusts the WA Hash aggregator GCal and its real
 *     hares win the merge full-update branch going forward.
 *   - #2216 Charm City H3 iCal Feed → config.stripTitleHareSuffix = true, so the
 *     adapter strips the "~ <hares>" suffix from the title on every scrape.
 *     (No-op until the adapter code that reads the flag is deployed.)
 *
 * Idempotent: re-running matches the desired state and reports "already set".
 *
 * Run (Railway proxy uses a self-signed cert):
 *   Dry-run: DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/sync-source-config-2214-2216.ts
 *   Apply:   DATABASE_URL=... BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/sync-source-config-2214-2216.ts --apply
 */
import { runOneShot } from "./lib/one-shot";

void runOneShot(async ({ prisma, apply }) => {
  // ── #2214 PSH3 trustLevel 5 → 7 ──────────────────────────────────────────
  {
    const s = await prisma.source.findFirst({
      where: { name: "Puget Sound H3 Hareline Sheet" },
      select: { id: true, trustLevel: true },
    });
    if (!s) {
      console.log(`\n#2214: "Puget Sound H3 Hareline Sheet" not found.`);
    } else if (s.trustLevel === 7) {
      console.log(`\n#2214 PSH3 trustLevel already 7 — no change.`);
    } else {
      console.log(`\n#2214 PSH3 trustLevel ${s.trustLevel} → 7`);
      if (apply) {
        await prisma.source.update({ where: { id: s.id }, data: { trustLevel: 7 } });
        console.log(`   ✏️  updated`);
      }
    }
  }

  // ── #2216 CCH3 config.stripTitleHareSuffix = true (merge, don't replace) ──
  {
    const s = await prisma.source.findFirst({
      where: { name: "Charm City H3 iCal Feed" },
      select: { id: true, config: true },
    });
    if (!s) {
      console.log(`\n#2216: "Charm City H3 iCal Feed" not found.`);
    } else {
      const config = (s.config ?? {}) as Record<string, unknown>;
      if (config.stripTitleHareSuffix === true) {
        console.log(`\n#2216 CCH3 stripTitleHareSuffix already true — no change.`);
      } else {
        console.log(`\n#2216 CCH3 config += stripTitleHareSuffix: true`);
        if (apply) {
          await prisma.source.update({
            where: { id: s.id },
            data: { config: { ...config, stripTitleHareSuffix: true } },
          });
          console.log(`   ✏️  updated`);
        }
      }
    }
  }

  console.log(`\n${apply ? "Applied." : "Dry run complete — re-run with --apply to write."}`);
});
