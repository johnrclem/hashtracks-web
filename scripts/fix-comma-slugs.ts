/**
 * One-shot data repair for issue #2308 — kennel slugs that contain characters
 * outside the URL-safe `[a-z0-9-]` set (the trigger was `slut-h3` whose slug
 * was the literal `sl,ut-discovery`). A comma in a slug makes the
 * `/kennels/<slug>` route 404 (the comma in the path never resolves to the
 * stored value), so the kennel's public page is unreachable and every card
 * linking via `kennel.slug` emits a dead href.
 *
 * `toSlug` (src/lib/kennel-utils.ts) already normalizes commas to "-", so this
 * is stale data predating the current generator. The script re-slugifies every
 * offending row to a unique `toSlug(shortName)`, disambiguating with a numeric
 * suffix on the rare collision.
 *
 * NOT a `backfill-*.ts` (those are owned by another workstream); this is a
 * scoped slug repair. Idempotent / re-runnable — rows that already have a clean
 * slug are skipped.
 *
 *   tsx scripts/fix-comma-slugs.ts          # dry-run (default)
 *   tsx scripts/fix-comma-slugs.ts --apply  # write changes
 *
 * Per memory `reference_script_railway_tls_self_signed.md` — set
 * BACKFILL_ALLOW_SELF_SIGNED_CERT=1 when pointing at the Railway public proxy.
 * Per `feedback_script_env_loading.md` — `import "dotenv/config"` because tsx
 * doesn't auto-load .env.
 */
import "dotenv/config";
import { createScriptPool } from "./lib/db-pool";
import { toSlug } from "@/lib/kennel-utils";

/** A slug is clean iff it's a non-empty run of lowercase alphanumerics + hyphens. */
const CLEAN_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface KennelRow {
  id: string;
  kennelCode: string;
  shortName: string;
  slug: string;
}

/**
 * Pick a unique slug for `shortName`, starting from `toSlug(shortName)` and
 * appending `-2`, `-3`, … until it doesn't collide with a slug already taken.
 * `taken` is mutated so a batch of repairs in one run can't collide with each
 * other.
 */
function uniqueSlug(shortName: string, taken: Set<string>): string {
  const base = toSlug(shortName) || "kennel";
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  taken.add(candidate);
  return candidate;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pool = createScriptPool();

  try {
    const { rows } = await pool.query<KennelRow>(
      `SELECT id, "kennelCode", "shortName", slug FROM "Kennel"`,
    );

    const taken = new Set(rows.map((r) => r.slug));
    const offenders = rows.filter((r) => !CLEAN_SLUG_RE.test(r.slug));

    if (offenders.length === 0) {
      console.log("[fix-comma-slugs] No malformed slugs found — nothing to do.");
      return;
    }

    console.log(
      `[fix-comma-slugs] ${offenders.length} kennel(s) with malformed slugs${apply ? "" : " (dry-run)"}:`,
    );

    for (const k of offenders) {
      // Free the old slug before picking a replacement so a row can re-take its
      // own normalized form without a needless `-2` suffix.
      taken.delete(k.slug);
      const newSlug = uniqueSlug(k.shortName, taken);
      console.log(
        `  ${k.kennelCode} (${k.shortName}): "${k.slug}" -> "${newSlug}"`,
      );
      if (apply) {
        await pool.query(`UPDATE "Kennel" SET slug = $1 WHERE id = $2`, [
          newSlug,
          k.id,
        ]);
      }
    }

    console.log(
      apply
        ? `[fix-comma-slugs] Applied ${offenders.length} update(s).`
        : `[fix-comma-slugs] Dry-run complete. Re-run with --apply to write.`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[fix-comma-slugs] Failed:", err);
  process.exitCode = 1;
});
