/**
 * Shared markdown fragments for audit prompts.
 *
 * Centralized so the deep-dive (chrome-kennel) and hareline (chrome-event)
 * prompts can't drift apart on suppression/schema-gap guidance, and the
 * cross-reference issue numbers (#503, #504) update in one place when the
 * schema work lands.
 */

import { HASHTRACKS_REPO } from "@/lib/github-repo";

/** Live suppressions endpoint shown to chrome agents before they file. */
export const AUDIT_SUPPRESSIONS_URL =
  "https://hashtracks.xyz/api/audit/suppressions";

/**
 * Markdown bullet list of fields that have no schema column on the Event
 * model today. Tag findings against these as `schema-gap`, not as extraction
 * bugs, so they route to a PRD decision instead of an adapter PR.
 *
 * `cost` and `endTime` aren't yet on the Event schema — the user-visible
 * field lists in both prompts ("title, date, start time, hares, location,
 * description, run number") deliberately omit them so the prompts don't
 * contradict themselves. Once #503/#504 land, drop the corresponding bullet
 * here and add the field to the user-visible list.
 */
export const SCHEMA_GAP_FIELDS_MD = [
  "- `endTime` — schema work tracked in #504",
  "- `cost` — schema work tracked in #503",
  "- `trailType`, `shiggy level`, `beer meister`, `on-after venue`, `what to bring` — no schema decision yet; flag with rule `schema-gap` and the PRD owner can group them",
].join("\n");

/**
 * Render the "Filing findings" section shared between the chrome-kennel and
 * chrome-event prompts. Sonar's duplication detector flagged the previous
 * inline copies (~25 lines each, 19% of the changeset). The two callers
 * differ only in:
 *   - the stream label suffix (`chrome-kennel` vs `chrome-event`)
 *   - the kennel-label slot (live `kennelCode` vs `{KENNEL_CODE}` placeholder)
 *   - whether bundling guidance precedes the section (deep-dive only)
 *
 * Pass the resolved `kennelLabel` — for the deep-dive prompt that's the
 * concrete `kennelCode`; for the hareline prompt it's the literal string
 * `{KENNEL_CODE}` (chrome agents substitute it per finding).
 */
export interface FilingInstructionsInput {
  stream: "chrome-kennel" | "chrome-event";
  kennelLabel: string;
}

export function renderFilingInstructions(
  input: FilingInstructionsInput,
): string {
  const labels = `audit,alert,audit:${input.stream},kennel:${input.kennelLabel}`;
  const issueUrl = `https://github.com/${HASHTRACKS_REPO}/issues/new?labels=${labels}&title={URL-ENCODED TITLE}&body={URL-ENCODED BODY}`;

  return `**Option 1 (preferred):** Open this URL in a new tab with title and body URL-encoded. The labels list is pre-baked with \`audit:${input.stream}\` (stream attribution) and \`kennel:${input.kennelLabel}\` (kennel attribution) so the dashboard's "Findings by stream" panel can route the issue correctly:

\`\`\`text
${issueUrl}
\`\`\`

**Option 2 (fallback):** Output the finding in this format and the admin will file it:

### [Kennel] — [Issue Category]
* **HashTracks Event URL:** [link]
* **Source URL:** [link]
* **Suspected Adapter:** [source type]
* **Field(s) Affected:** [field name]
* **Current Extracted Value:** "[exact text from the HashTracks page, verbatim]"
* **Expected Value:** "[verbatim text from the source — **not** a synthesized cleanup or inference. If the source says "2FC Takes Fenton", that's the expected value; don't 'clean it up' to "2FC" unless the source literally shows that string somewhere.]"
* **Fix Hypothesis:** [brief guess on root cause]`;
}
