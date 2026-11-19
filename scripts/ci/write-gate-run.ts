/**
 * The `write-gate` workflow's runner (`.github/workflows/write-gate.yml`). It runs from main's
 * checkout on `pull_request_target` and reads the PR only through the API, as data: it never
 * checks out, installs or runs the PR's code.
 *
 * On each event it:
 *   1. marks `write-gate` pending on the PR's current head, so a crash can't leave an old success;
 *   2. stamps `backfill/approved` on the event's head when the owner (and only the owner, as a
 *      user, in a run the owner triggered) adds `owner-approved`; anyone else's label is ignored,
 *      with a comment saying so;
 *   3. classifies the PR and evaluates it (`write-gate.ts`), then sets the `write-gate` status and
 *      one `write:*` label.
 *
 * Env: GITHUB_TOKEN (the workflow's), GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GITHUB_TRIGGERING_ACTOR,
 * OWNER_GITHUB_LOGIN, AGENT_BOT_LOGIN, and GITHUB_STEP_SUMMARY / GITHUB_RUN_ID
 * for the summary and links.
 */
import { appendFileSync, readFileSync } from "node:fs";
import {
  APPROVAL_LABEL,
  APPROVAL_REPO,
  approvalClient,
  checkStampedHead,
  ownerGithubLogin,
  refuseFork,
  STAMP_CONTEXT,
  STAMP_CREATOR,
  stampDescription,
  TerminalApprovalError,
  type CommitStatus,
  type GitHub,
  type PullRequest as ApprovalPullRequest,
} from "@/lib/backfill/approval-stamp";
import {
  DEFAULT_AGENT_BOT_LOGIN,
  evaluateGate,
  GATE_CONTEXT,
  parsePusher,
  PUSHER_CONTEXT,
  WRITE_CLASSES,
  type ApprovalResult,
  type WriteClass,
  type ChangedFile,
  type GateVerdict,
} from "./write-gate";

interface GateEvent {
  action: string;
  label?: { name: string };
  sender: { login: string; type: string };
  pull_request: { number: number; head: { sha: string }; base: { ref: string } };
}

/** The only branch the gate judges (the workflow triggers for no other). */
const GATED_BASE = "main";

type PullRequest = ApprovalPullRequest & {
  head: { ref: string };
  user: { login: string; type: string };
};

const SHA_RE = /^[0-9a-f]{40}$/;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function writeInit(method: "POST" | "DELETE", body?: unknown): RequestInit {
  return {
    method,
    headers: {
      Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  };
}

function checkOk(res: Response, what: string): void {
  if (!res.ok) throw new Error(`GitHub ${what}: HTTP ${res.status}`);
}

/** The only writes the gate makes, each to a fixed api.github.com path built from checked values. */
function checkedPr(number: number): number {
  if (!Number.isInteger(number) || number <= 0) throw new Error(`not a pull request number: ${number}`);
  return number;
}

function checkedSha(sha: string): string {
  if (!SHA_RE.test(sha)) throw new Error(`not a commit SHA: ${sha}`);
  return sha;
}

/** The run's page, from a numeric run id only: a status link is never built from free text. */
function runUrl(): string {
  const runId = Number(process.env.GITHUB_RUN_ID);
  const runs = `https://github.com/${APPROVAL_REPO}/actions`;
  return Number.isSafeInteger(runId) && runId > 0 ? `${runs}/runs/${runId}` : runs;
}

async function setStatus(sha: string, context: string, state: GateVerdict["state"], description: string): Promise<void> {
  const url = new URL(`/repos/${APPROVAL_REPO}/statuses/${checkedSha(sha)}`, "https://api.github.com");
  const init = writeInit("POST", { context, state, description, target_url: runUrl() });
  const res = await fetch(url, init);
  checkOk(res, `status ${context}`);
}

async function postComment(number: number, body: string): Promise<void> {
  const url = new URL(`/repos/${APPROVAL_REPO}/issues/${checkedPr(number)}/comments`, "https://api.github.com");
  const init = writeInit("POST", { body });
  const res = await fetch(url, init);
  checkOk(res, "comment");
}

async function addLabel(number: number, label: WriteClass): Promise<void> {
  const url = new URL(`/repos/${APPROVAL_REPO}/issues/${checkedPr(number)}/labels`, "https://api.github.com");
  const init = writeInit("POST", { labels: [label] });
  const res = await fetch(url, init);
  checkOk(res, "add label");
}

async function removeLabel(number: number, label: WriteClass): Promise<void> {
  // `label` is one of the fixed write classes, never PR data.
  const url = new URL(`/repos/${APPROVAL_REPO}/issues/${checkedPr(number)}/labels/${encodeURIComponent(label)}`, "https://api.github.com");
  const init = writeInit("DELETE");
  const res = await fetch(url, init);
  // Removing a label that isn't there is fine.
  if (res.status !== 404) checkOk(res, "remove label");
}

/**
 * Retries a write a few times. Used for the first pending status: until it lands, an earlier
 * success on the same head still stands.
 */
async function withRetry(write: () => Promise<void>, attempts = 4): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await write();
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

/** A2–A4 for the PR as read (the same snapshot the gate classifies), as the gate's three outcomes. */
async function approvalFor(gh: GitHub, pr: PullRequest): Promise<ApprovalResult> {
  try {
    refuseFork(pr);
    return { kind: "approved", stampedSha: await checkStampedHead(gh, pr, pr.base.sha) };
  } catch (err) {
    let reason = err instanceof Error ? err.message : String(err);
    // The label is on but its stamp never arrived: its gate run may have been dropped from the queue.
    if (reason.startsWith("A3: no stamp yet") || reason.startsWith("A3: waiting")) reason += "; if it never comes, re-add owner-approved";
    // Only a terminal verdict refuses; anything unexpected may pass on the next event.
    return err instanceof TerminalApprovalError ? { kind: "refused", reason } : { kind: "waiting", reason };
  }
}

/**
 * The owner's `owner-approved` stamps the head GitHub reported with the label event; anyone else's
 * (or a re-run of the owner's event started by someone else) gets a comment saying it was ignored.
 * Returns a line for the summary.
 */
async function stampOrIgnore(gh: GitHub, event: GateEvent, owner: string): Promise<string> {
  const number = event.pull_request.number;
  const byOwner = event.sender.login === owner && event.sender.type === "User";
  const ownerRan = process.env.GITHUB_TRIGGERING_ACTOR === owner;
  if (byOwner && ownerRan) {
    await setStatus(event.pull_request.head.sha, STAMP_CONTEXT, "success", stampDescription(number));
    return `Stamped \`${STAMP_CONTEXT}\` on ${event.pull_request.head.sha.slice(0, 7)}.`;
  }
  const who = byOwner ? `a re-run started by \`${process.env.GITHUB_TRIGGERING_ACTOR ?? "unknown"}\`` : `\`${event.sender.login}\``;
  const text = `The write gate ignored \`${APPROVAL_LABEL}\` from ${who}: only the owner's own label approves a pull request. Remove the label; it doesn't count.`;
  // One comment per wording, however often the label is added or removed.
  const comments = await gh.list<{ body?: string | null }>(`/issues/${number}/comments`);
  if (!comments.some((c) => c.body === text)) await postComment(number, text);
  return text;
}

async function main(): Promise<void> {
  if (env("GITHUB_REPOSITORY") !== APPROVAL_REPO) throw new Error(`the gate only runs on ${APPROVAL_REPO}`);
  const token = env("GITHUB_TOKEN");
  const event = JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8")) as GateEvent;
  const number = event.pull_request.number;
  if (!Number.isInteger(number) || number <= 0) throw new Error("the event has no pull request number");
  if (event.pull_request.base.ref !== GATED_BASE) {
    // The workflow filters these out; never issue a verdict against another base.
    console.log(`PR #${number} targets ${event.pull_request.base.ref}, not ${GATED_BASE}: nothing to judge.`);
    return;
  }
  const owner = ownerGithubLogin();
  const agentBot = process.env.AGENT_BOT_LOGIN?.trim() || DEFAULT_AGENT_BOT_LOGIN;
  const gh = approvalClient({ token });

  // 1. Mark the event's head pending before anything can fail (an `unlabeled` run that crashed
  //    must not leave the earlier success standing), then read the PR as it is now.
  await withRetry(() => setStatus(event.pull_request.head.sha, GATE_CONTEXT, "pending", "Evaluating…"));
  const pr = await gh.get<PullRequest>(`/pulls/${number}`);
  if (pr.base.ref !== GATED_BASE) throw new Error(`PR #${number} now targets ${pr.base.ref}, not ${GATED_BASE}`);
  const head = pr.head.sha;
  if (head !== event.pull_request.head.sha) await setStatus(head, GATE_CONTEXT, "pending", "Evaluating…");

  // 2. Stamp, or say why not.
  const notes = event.action === "labeled" && event.label?.name === APPROVAL_LABEL ? [await stampOrIgnore(gh, event, owner)] : [];

  // 3. Classify and evaluate the PR's head as it is now.
  const [files, headStatuses, approval] = await Promise.all([
    gh.list<ChangedFile>(`/pulls/${number}/files`),
    // Newest first; only statuses the workflow itself set count.
    gh.get<CommitStatus[]>(`/commits/${head}/statuses?per_page=100`),
    approvalFor(gh, pr),
  ]);
  const pusher = headStatuses.find((s) => s.context === PUSHER_CONTEXT && s.creator?.login === STAMP_CREATOR);
  const verdict = evaluateGate({
    author: pr.user,
    headPusher: parsePusher(pusher?.description),
    headRef: pr.head.ref,
    sameRepo: pr.head.repo?.full_name === APPROVAL_REPO,
    files,
    approval,
    ownerLogin: owner,
    agentBotLogin: agentBot,
  });

  const labels = new Set(pr.labels.map((l) => l.name));
  for (const stale of WRITE_CLASSES.filter((c) => c !== verdict.writeClass && labels.has(c))) {
    await removeLabel(number, stale);
  }
  if (!labels.has(verdict.writeClass)) await addLabel(number, verdict.writeClass);
  await setStatus(head, GATE_CONTEXT, verdict.state, verdict.description);

  const summary = [
    `### write-gate: ${verdict.state}`,
    "",
    `- PR #${number}, head \`${head.slice(0, 7)}\`, branch \`${pr.head.ref}\`, author \`${pr.user.login}\` (${pr.user.type}), head pushed by ${pusher?.description ?? "unrecorded"}`,
    `- Class: \`${verdict.writeClass}\`; passed by: ${verdict.path ?? "nothing"}`,
    `- ${verdict.description}`,
    ...notes.map((n) => `- ${n}`),
    `- ${files.length} file(s) changed`,
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}

main().catch((err) => {
  // The pending status set first stays in place, so a crash never lets a PR through.
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
