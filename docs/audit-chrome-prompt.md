# HashTracks Daily Hareline Audit — Chrome Prompt

> The active prompt is now **server-rendered** so its curated sections (Recently Fixed, Focus Areas, Active Suppressions) stay current automatically.
>
> **To copy the prompt**, open `/admin/audit` and click **Copy daily prompt**. The button calls [`buildHarelinePrompt`](../src/lib/admin/hareline-prompt.ts) with live inputs from the audit-issue mirror and the source table.

## Why the static file went away

Pre-rotation, this doc kept a hand-curated "Recently Fixed (Last 2 Weeks)" list and a "Focus Areas This Week" list. Both decayed quickly (the fixed-list still referenced PR #423 long after the team had moved past PR #1100+) and silently misled chrome-event auditors.

The dynamic builder pulls:

- **Recently Fixed** — closed `audit`-labeled issues from the last 14 days (`auditIssue` mirror).
- **Focus Areas** — sources added in the last 14 days (`Source.createdAt`).
- **Active Suppressions** — links to the live endpoint at `/api/audit/suppressions`.

## Editing the prompt

Edit the TypeScript builder at [`src/lib/admin/hareline-prompt.ts`](../src/lib/admin/hareline-prompt.ts). Tests live next to it. The deep-dive prompt at [`src/lib/admin/deep-dive-prompt.ts`](../src/lib/admin/deep-dive-prompt.ts) follows the same shape.

## For kennel deep dives

Use the **Kennel Deep Dive** section on `/admin/audit` instead — that prompt is built per-kennel with the source URLs baked in.
