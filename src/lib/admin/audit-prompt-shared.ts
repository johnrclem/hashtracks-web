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

/**
 * Map the prompt's stream slug ("chrome-kennel" / "chrome-event") to
 * the API endpoint's enum literal ("CHROME_KENNEL" / "CHROME_EVENT").
 */
function streamLiteralFor(stream: FilingInstructionsInput["stream"]): string {
  return stream === "chrome-kennel" ? "CHROME_KENNEL" : "CHROME_EVENT";
}

export function renderFilingInstructions(
  input: FilingInstructionsInput,
): string {
  const apiStream = streamLiteralFor(input.stream);
  // Always JSON-quote the kennelLabel value — even the hareline
  // placeholder. Codex 5c-C pass-1 finding: an unquoted
  // `{KENNEL_CODE}` produces invalid JSON in the prompt example,
  // which confuses the agent at copy time. With quotes the example
  // is valid JSON syntactically; the surrounding prose tells the
  // agent to substitute the literal placeholder.
  const kennelJsonValue = `"${input.kennelLabel}"`;

  return `**Option 1 (preferred): file via the audit API**

Two-step flow: mint a single-use nonce, then POST the finding. Both calls run in your browser (admin Clerk session, same-origin). Server computes the payload hash, files the GitHub issue, and runs cross-stream coalescing — so if the same finding already has an open issue you'll get a "recurred" outcome instead of a duplicate.

**Step 1 — mint:** \`POST /api/audit/mint-filing-nonce\`

\`\`\`json
{
  "stream": "${apiStream}",
  "kennelCode": ${kennelJsonValue},
  "ruleSlug": "<rule-slug>",
  "title": "<your issue title>",
  "eventIds": ["<event-id-1>", "<event-id-2>"],
  "bodyMarkdown": "<your issue body, markdown>"
}
\`\`\`

Response: \`{ "nonce": "<base64url>" }\` (5-minute TTL, single-use).

**Step 2 — file:** \`POST /api/audit/file-finding\`

\`\`\`json
{
  "nonce": "<from step 1>",
  "stream": "${apiStream}",
  "kennelCode": ${kennelJsonValue},
  "ruleSlug": "<same as step 1>",
  "title": "<same>",
  "eventIds": ["<same>"],
  "bodyMarkdown": "<same>"
}
\`\`\`

Response shapes:
- \`{ "action": "created", "issueNumber": N, "issueHtmlUrl": "..." }\` — fresh issue filed.
- \`{ "action": "recurred", "tier": "strict" | "bridging" | "coarse", "existingIssueNumber": N, "existingIssueHtmlUrl": "...", "recurrenceCount": N }\` — same finding already had an open issue; we commented "still recurring" instead of forking. **Don't refile.** (\`coarse\` is the dedup path for non-fingerprintable rules — see #964.)
- \`{ "error": "...", "existingIssueNumber"?: N }\` (502) — GitHub side effect failed; safe to retry the same nonce.
- \`{ "error": "Nonce invalid, expired, or payload tampered" }\` (401) — nonce mismatch; mint a fresh one and retry.

The labels (\`audit\`, \`alert\`, \`audit:${input.stream}\`, \`kennel:${input.kennelLabel}\`) are applied server-side; you don't set them yourself.

**Option 2 (fallback): paste the finding for an admin to file manually**

Use this only if the API call fails after a fresh nonce. Output the finding in this format:

### [Kennel] — [Issue Category]
* **HashTracks Event URL:** [link]
* **Source URL:** [link]
* **Suspected Adapter:** [source type]
* **Field(s) Affected:** [field name]
* **Current Extracted Value:** "[exact text from the HashTracks page, verbatim]"
* **Expected Value:** "[verbatim text from the source — **not** a synthesized cleanup or inference. If the source says "2FC Takes Fenton", that's the expected value; don't 'clean it up' to "2FC" unless the source literally shows that string somewhere.]"
* **Fix Hypothesis:** [brief guess on root cause]

**Option 3 (legacy fallback): GitHub URL flow**

Old prompts used to direct agents to a prefilled \`https://github.com/${HASHTRACKS_REPO}/issues/new?...\` URL. That path is still supported and will be detected by the bridging tier on the next sync round, but **prefer Option 1** so cross-stream coalescing fires immediately and you don't fork a duplicate.`;
}
