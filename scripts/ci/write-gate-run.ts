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
 * OWNER_GITHUB_LOGIN, AGENT_BOT_LOGIN, and GITHUB_STEP_SUMMARY / GITHUB_SERVER_URL / GITHUB_RUN_ID
 * for the summary and links.
 */
import { appendFileSync, readFileSync } from "node:fs";
import {
  APPROVAL_LABEL,
  APPROVAL_REPO,
  approvalClient,
  checkOpenPrApproval,
  ownerGithubLogin,
  STAMP_CONTEXT,
  stampDescription,
  TerminalApprovalError,
} from "@/lib/backfill/approval-stamp";
import {
  DEFAULT_AGENT_BOT_LOGIN,
  evaluateGate,
  GATE_CONTEXT,
  parsePusher,
  PUSHER_CONTEXT,
  WRITE_CLASSES,
  type ApprovalResult,
  type ChangedFile,
  type GateVerdict,
} from "./write-gate";

interface GateEvent {
  action: string;
  label?: { name: string };
  sender: { login: string; type: string };
  pull_request: { number: number; head: { sha: string } };
}

interface PullRequest {
  number: number;
  head: { sha: string; ref: string; repo: { full_name: string } | null };
  user: { login: string; type: string };
  labels: Array<{ name: string }>;
}

const SHA_RE = /^[0-9a-f]{40}$/;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** Writes through the workflow's token. Reads go through the approval read client. */
async function write(path: string, method: "POST" | "DELETE", body?: unknown): Promise<void> {
  const res = await fetch(new URL(`/repos/${APPROVAL_REPO}${path}`, "https://api.github.com"), {
    method,
    headers: {
      Authorization: `Bearer ${env("GITHUB_TOKEN")}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  // Removing a label that isn't there is fine.
  if (!res.ok && !(method === "DELETE" && res.status === 404)) throw new Error(`GitHub ${method} ${path}: HTTP ${res.status}`);
}

function setStatus(sha: string, context: string, state: GateVerdict["state"], description: string, targetUrl: string): Promise<void> {
  if (!SHA_RE.test(sha)) throw new Error(`not a commit SHA: ${sha}`);
  return write(`/statuses/${sha}`, "POST", { context, state, description, target_url: targetUrl });
}

/** A2–A4 for the PR's current head, as the gate's three outcomes. */
async function approvalFor(prNumber: number, token: string): Promise<ApprovalResult> {
  try {
    const approved = await checkOpenPrApproval(prNumber, { token });
    return { kind: "approved", stampedSha: approved.stampedSha };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // Only a terminal verdict refuses; anything unexpected may pass on the next event.
    return err instanceof TerminalApprovalError ? { kind: "refused", reason } : { kind: "waiting", reason };
  }
}

async function main(): Promise<void> {
  if (env("GITHUB_REPOSITORY") !== APPROVAL_REPO) throw new Error(`the gate only runs on ${APPROVAL_REPO}`);
  const token = env("GITHUB_TOKEN");
  const event = JSON.parse(readFileSync(env("GITHUB_EVENT_PATH"), "utf8")) as GateEvent;
  const number = event.pull_request.number;
  if (!Number.isInteger(number) || number <= 0) throw new Error("the event has no pull request number");
  const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${APPROVAL_REPO}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`;
  const owner = ownerGithubLogin();
  const agentBot = process.env.AGENT_BOT_LOGIN?.trim() || DEFAULT_AGENT_BOT_LOGIN;
  const gh = approvalClient({ token });

  // 1. Mark the event's head pending before anything can fail (an `unlabeled` run that crashed
  //    must not leave the earlier success standing), then read the PR as it is now.
  await setStatus(event.pull_request.head.sha, GATE_CONTEXT, "pending", "Evaluating…", runUrl);
  const pr = await gh.get<PullRequest>(`/pulls/${number}`);
  const head = pr.head.sha;
  if (head !== event.pull_request.head.sha) await setStatus(head, GATE_CONTEXT, "pending", "Evaluating…", runUrl);

  // 2. Stamp, or say why not. The stamp marks the head GitHub reported with the label event.
  const notes: string[] = [];
  if (event.action === "labeled" && event.label?.name === APPROVAL_LABEL) {
    const byOwner = event.sender.login === owner && event.sender.type === "User";
    // A re-run of the owner's label event by someone else must not stamp again.
    const ownerRan = process.env.GITHUB_TRIGGERING_ACTOR === owner;
    if (byOwner && ownerRan) {
      await setStatus(event.pull_request.head.sha, STAMP_CONTEXT, "success", stampDescription(number), runUrl);
      notes.push(`Stamped \`${STAMP_CONTEXT}\` on ${event.pull_request.head.sha.slice(0, 7)}.`);
    } else {
      const who = byOwner ? `a re-run started by \`${process.env.GITHUB_TRIGGERING_ACTOR ?? "unknown"}\`` : `\`${event.sender.login}\``;
      const text = `The write gate ignored \`${APPROVAL_LABEL}\` from ${who}: only the owner's own label approves a pull request. Remove the label; it doesn't count.`;
      await write(`/issues/${number}/comments`, "POST", { body: text });
      notes.push(text);
    }
  }

  // 3. Classify and evaluate the PR's head as it is now.
  const files = await gh.list<ChangedFile>(`/pulls/${number}/files`);
  // Statuses come newest first; only the workflow's own count.
  const headStatuses = await gh.get<Array<{ context: string; description: string | null; creator?: { login: string } | null }>>(
    `/commits/${head}/statuses?per_page=100`,
  );
  const pusher = headStatuses.find((s) => s.context === PUSHER_CONTEXT && s.creator?.login === "github-actions[bot]");
  const verdict = evaluateGate({
    author: pr.user,
    headPusher: parsePusher(pusher?.description),
    headRef: pr.head.ref,
    sameRepo: pr.head.repo?.full_name === APPROVAL_REPO,
    files,
    approval: await approvalFor(number, token),
    ownerLogin: owner,
    agentBotLogin: agentBot,
  });

  const labels = new Set(pr.labels.map((l) => l.name));
  for (const stale of WRITE_CLASSES.filter((c) => c !== verdict.writeClass && labels.has(c))) {
    await write(`/issues/${number}/labels/${encodeURIComponent(stale)}`, "DELETE");
  }
  if (!labels.has(verdict.writeClass)) await write(`/issues/${number}/labels`, "POST", { labels: [verdict.writeClass] });
  await setStatus(head, GATE_CONTEXT, verdict.state, verdict.description, runUrl);

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
