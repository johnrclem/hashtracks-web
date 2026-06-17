/**
 * Seoul H3 hare PII scrubbing.
 *
 * The Korea-specific scrubber discovered on Seoul H3 (PR #2227) has been
 * generalized into the shared `@/adapters/hare-pii` module and wired into the
 * merge pipeline's `sanitizeHares`, so EVERY adapter's hares are now scrubbed at
 * ingest. This file re-exports the shared functions to keep the Seoul adapter
 * (`seoul-h3.ts` `parseEventBlock`) and the frozen-archive regression test
 * (`scripts/backfill-sh3-kr-history.test.ts`) importing from a stable path —
 * defense in depth with a single source of truth.
 */
export { scrubHarePii, containsHarePii } from "@/adapters/hare-pii";
