import { prisma } from "@/lib/db";

/**
 * A Hash Rego link (`SourceKennel.externalSlug` on the HASHREGO source) selects
 * an account to scrape by its slug. A resolved kennel tag is a display name,
 * not a slug: "Hash House Harriettes" resolves to NYC's Harriettes but is
 * Seattle's account. So repair actions that link a kennel from a tag refuse
 * Hash Rego; its links are set on the source page with the account slug, or by
 * the seed's `kennelSlugMap`.
 */
export const HASHREGO_TAG_LINK_REFUSAL =
  "Hash Rego links need the account's slug. Link the kennel on the source page and set its slug there.";

/** Whether a source is the HASHREGO source. */
export async function isHashRegoSource(sourceId: string): Promise<boolean> {
  const source = await prisma.source.findUnique({ where: { id: sourceId }, select: { type: true } });
  return source?.type === "HASHREGO";
}
