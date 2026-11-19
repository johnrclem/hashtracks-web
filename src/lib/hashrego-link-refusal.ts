/** Client-safe: shown by the Hash Rego repair actions and by the admin UI that hides them. */

/**
 * A Hash Rego link (`SourceKennel.externalSlug` on the HASHREGO source) selects
 * an account to scrape by its slug. A resolved kennel tag is a display name,
 * not a slug: "Hash House Harriettes" resolves to NYC's Harriettes but is
 * Seattle's account. So repair actions that link a kennel from a tag refuse
 * Hash Rego. The scraped accounts are the seed's `kennelSlugMap`, shipped to
 * prod with a data migration.
 */
export const HASHREGO_TAG_LINK_REFUSAL =
  "Hash Rego links need the account's slug: add the kennel and its slug to the Hash Rego kennelSlugMap in prisma/seed-data/sources.ts and ship a data migration.";
