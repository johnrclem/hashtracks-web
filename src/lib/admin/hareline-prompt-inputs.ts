/**
 * Live inputs for the daily hareline audit prompt: recently closed audit
 * issues and recently onboarded sources.
 *
 * This module has no auth check. Callers gate it themselves:
 * - `getHarelinePromptInputs` (admin server action): `requireAdmin()`
 * - `/api/audit/agent/hareline-prompt`: `AUDIT_AGENT_TOKEN`
 */
import { AuditStream } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { daysAgo, easternDate } from "./audit-dates";
import type {
  FocusAreaItem,
  HarelinePromptInputs,
  RecentlyFixedItem,
} from "./hareline-prompt";

const HARELINE_PROMPT_WINDOW_DAYS = 14;
const HARELINE_PROMPT_LIST_LIMIT = 8;
/**
 * Fetch the dynamic inputs for `buildHarelinePrompt`. These replace the
 * hand-curated "Recently Fixed" / "Focus Areas" sections of the old static
 * prompt, which decayed into stale references.
 */
export async function loadHarelinePromptInputs(): Promise<HarelinePromptInputs> {
  const since = daysAgo(HARELINE_PROMPT_WINDOW_DAYS);

  const [closedIssues, recentSources] = await Promise.all([
    prisma.auditIssue.findMany({
      where: {
        state: "closed",
        delistedAt: null,
        githubClosedAt: { gte: since },
        // Scope to the human-driven streams. Including AUTOMATED would mix
        // cron-auto-closed structural findings into a list whose readers are
        // chrome auditors looking for "fixes the team verified."
        stream: { in: [AuditStream.CHROME_EVENT, AuditStream.CHROME_KENNEL] },
        // Exclude `state_reason="not_planned"` closures — those are
        // operator-marked false positives, not fixes. Advertising them
        // as "Recently Fixed" would actively mis-teach future auditors.
        // `null` closeReason (legacy rows pre-PR #1171 that haven't
        // re-synced yet) is permitted so the list isn't empty during
        // rollout; the next sync cycle populates the field for them.
        closeReason: { not: "not_planned" },
      },
      select: { githubNumber: true, title: true, githubClosedAt: true },
      orderBy: { githubClosedAt: "desc" },
      take: HARELINE_PROMPT_LIST_LIMIT,
    }),
    prisma.source.findMany({
      where: { enabled: true, createdAt: { gte: since } },
      select: { name: true, type: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: HARELINE_PROMPT_LIST_LIMIT,
    }),
  ]);

  // `githubClosedAt` is non-null at runtime (the where clause filters
  // `gte: since`), but Prisma's projected type still includes null. Filter
  // narrows it without the bare `!` assertion Sonar flagged.
  const recentlyFixed: RecentlyFixedItem[] = closedIssues
    .filter(
      (i): i is typeof i & { githubClosedAt: Date } => i.githubClosedAt !== null,
    )
    .map((i) => ({
      issueNumber: i.githubNumber,
      title: i.title,
      // easternDate keeps prompt dates in the same bucket as the rest of the dashboard.
      closedDate: easternDate(i.githubClosedAt),
    }));

  const focusAreas: FocusAreaItem[] = recentSources.map((s) => ({
    sourceName: s.name,
    sourceType: s.type,
    addedDate: easternDate(s.createdAt),
  }));

  return { recentlyFixed, focusAreas };
}
