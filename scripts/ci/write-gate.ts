/**
 * The write gate's decision (ops plan S4; docs/ops/system.md#write-gate). Pure: the workflow's
 * runner (`write-gate-run.ts`) reads the PR from GitHub and passes it in. Both live under
 * `scripts/ci/**`, which G15 protects, and `pull_request_target` always runs main's copy, so a PR
 * can't change what judges it.
 *
 * A PR passes in one of three ways:
 *   1. a valid owner approval (A2–A4, `src/lib/backfill/approval-stamp.ts`);
 *   2. owner-authored and low-risk: the owner opened it and pushed its head, from a branch outside
 *      the agent prefixes, with no migration change and no workflow change;
 *   3. bot-authored and data-only: every path in the onboarding data allow-list.
 * A workflow change passes only the first way.
 */
import { MIGRATION_DIR_PREFIX } from "@/lib/migration-sql/paths";

/** The commit status the gate sets on the PR head, and the ruleset requires. */
export const GATE_CONTEXT = "write-gate";
/**
 * Who moved the head: set by the workflow's `record-pusher` job on every opened, synchronize and
 * reopened event, as "<login> (<type>)". The agent App can't write statuses.
 */
export const PUSHER_CONTEXT = "write-gate/pusher";

/** Parses a pusher status description; null when it isn't one. */
export function parsePusher(description: string | null | undefined): { login: string; type: string } | null {
  const match = /^(\S+) \((\w+)\)$/.exec(description ?? "");
  return match ? { login: match[1], type: match[2] } : null;
}
/** The agent App's bot account (`<app slug>[bot]`). The workflow may override it (`AGENT_BOT_LOGIN`). */
export const DEFAULT_AGENT_BOT_LOGIN = "hashtracks-agent[bot]";

/**
 * Branch prefixes the scheduled tasks push under (docs/ops/system.md#branch-prefixes; a test
 * keeps them equal). A branch under one of these is an agent's, whoever pushed it.
 */
export const AGENT_BRANCH_PREFIXES = ["audit-fix/", "onboarding/", "onboard/", "deep-dive/", "hareline-audit/", "ops-digest/"] as const;

/** Files the onboarding research task may change without the owner (the bot's data-only path). */
const ONBOARDING_DATA_DIR = "docs/kennel-onboarding/";
const ONBOARDING_DATA_FILES = new Set(["run-log.md", "target-queue.md", "source-platform-notes.md"].map((f) => ONBOARDING_DATA_DIR + f));

export type WriteClass = "write:docs" | "write:code" | "write:migration" | "write:insert-auto";
export const WRITE_CLASSES: readonly WriteClass[] = ["write:docs", "write:code", "write:migration", "write:insert-auto"];

export interface ChangedFile {
  filename: string;
  /** GitHub's file status: added, modified, removed, renamed, copied, changed, unchanged. */
  status: string;
  previous_filename?: string;
}

/** Every path a change touches: a rename touches its old path too. */
function paths(files: readonly ChangedFile[]): string[] {
  return files.flatMap((f) => (f.previous_filename ? [f.filename, f.previous_filename] : [f.filename]));
}

/** In the onboarding data allow-list. Never a manual (`*-prompt.md`), whatever folder it is in. */
export function isOnboardingData(path: string): boolean {
  if (path.endsWith("-prompt.md")) return false;
  return path.startsWith(`${ONBOARDING_DATA_DIR}handoffs/`) || ONBOARDING_DATA_FILES.has(path);
}

/** Workflow definitions, and the local actions they can run. */
function isWorkflowPath(path: string): boolean {
  return path.startsWith(".github/workflows/") || path.startsWith(".github/actions/");
}

function isAgentBranch(ref: string): boolean {
  return AGENT_BRANCH_PREFIXES.some((prefix) => ref.startsWith(prefix));
}

/**
 * The PR's write class. `write:insert-auto` (an onboarding migration that only inserts new rows)
 * needs the auto-tier checks of ops plan S5; until they exist every migration is `write:migration`.
 */
export function classify(files: readonly ChangedFile[]): WriteClass {
  const all = paths(files);
  if (all.some((p) => p.startsWith(MIGRATION_DIR_PREFIX))) return "write:migration";
  if (all.length > 0 && all.every((p) => p.endsWith(".md") || p.startsWith("docs/"))) return "write:docs";
  return "write:code";
}

/** The A2–A4 result for the PR's current head. */
export type ApprovalResult =
  | { kind: "approved"; stampedSha: string }
  /** No label, no stamp yet, or GitHub couldn't be read: may pass later. */
  | { kind: "waiting"; reason: string }
  /** The approval can't pass for this head (a non-owner label, a push after the stamp). */
  | { kind: "refused"; reason: string };

export interface GateInput {
  author: { login: string; type: string };
  /** Who pushed the current head ({@link PUSHER_CONTEXT}), or null when it wasn't recorded. */
  headPusher: { login: string; type: string } | null;
  headRef: string;
  /** The head is in this repository, not a fork. */
  sameRepo: boolean;
  files: readonly ChangedFile[];
  approval: ApprovalResult;
  ownerLogin: string;
  agentBotLogin: string;
}

type GatePath = "approval" | "owner-authored" | "agent-data-only" | null;

export interface GateVerdict {
  state: "success" | "pending" | "failure";
  /** At most 140 characters: GitHub's limit for a status description. */
  description: string;
  path: GatePath;
  writeClass: WriteClass;
}

const verdict = (state: GateVerdict["state"], description: string, path: GatePath, writeClass: WriteClass): GateVerdict => ({
  state,
  description: description.length > 140 ? `${description.slice(0, 139)}…` : description,
  path,
  writeClass,
});

export function evaluateGate(input: GateInput): GateVerdict {
  const { author, files, approval } = input;
  const writeClass = classify(files);
  const all = paths(files);

  if (!input.sameRepo) return verdict("failure", "A pull request from a fork never passes the gate.", null, writeClass);
  if (approval.kind === "approved") {
    return verdict("success", `Approved by the owner at ${approval.stampedSha.slice(0, 7)}.`, "approval", writeClass);
  }

  const touchesWorkflows = all.some(isWorkflowPath);
  const isOwner = (who: { login: string; type: string } | null) => who?.login === input.ownerLogin && who.type === "User";
  // The owner opened it AND pushed its head: a bot push onto an owner's branch needs the label.
  const ownerAuthored = isOwner(author) && isOwner(input.headPusher);
  if (ownerAuthored && !touchesWorkflows && writeClass !== "write:migration" && !isAgentBranch(input.headRef)) {
    return verdict("success", "Owner-authored, no migration or workflow change.", "owner-authored", writeClass);
  }
  const agentAuthored = author.login === input.agentBotLogin && author.type === "Bot";
  if (agentAuthored && all.length > 0 && all.every(isOnboardingData)) {
    return verdict("success", "Agent data-only change (onboarding handoffs and logs).", "agent-data-only", writeClass);
  }

  const why = approval.kind === "refused" ? `Approval refused: ${approval.reason}` : `Needs the owner's approval: ${approval.reason}`;
  // A workflow change without approval is refused outright, not left waiting.
  if (touchesWorkflows || approval.kind === "refused") return verdict("failure", touchesWorkflows ? `Changes .github workflows. ${why}` : why, null, writeClass);
  return verdict("pending", why, null, writeClass);
}
