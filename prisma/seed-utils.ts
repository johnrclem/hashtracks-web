/**
 * Pure helpers shared between `prisma/seed.ts` and its test files. `seed.ts`
 * has a top-level `main().catch(...)` that connects to Postgres on import, so
 * tests cannot import from it directly. Put pure helpers here; `seed.ts`
 * re-exports them so call sites keep their original path.
 */

/** Strips a literal "/" (Next.js path-separator collision — #1422). Mirror of
 *  `src/lib/kennel-utils.ts` toSlug; the alignment test in seed-utils.test.ts
 *  enforces parity. */
export function toSlug(shortName: string): string {
  return shortName
    .toLowerCase()
    .replaceAll(/[()]/g, "")
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}
