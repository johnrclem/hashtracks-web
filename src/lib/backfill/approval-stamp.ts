/**
 * The backfill approval stamp, shared by the server's A2–A3 checks and the ops
 * `write-gate` workflow that sets it (docs/onboarding-backfill-automation-design.md
 * 6.3), so the stamp and the check can't drift apart. Pure: no network, no database.
 *
 * The workflow sets a commit status `backfill/approved` on the PR head when the
 * owner adds `owner-approved`, with `#<pr>` in its description.
 */

export const APPROVAL_LABEL = "owner-approved";
export const STAMP_CONTEXT = "backfill/approved";
/** Statuses set by the workflow come from Actions' token. */
export const STAMP_CREATOR = "github-actions[bot]";
const DEFAULT_OWNER_GITHUB_LOGIN = "johnrclem";

/** The only account whose label approves (A2). The workflow passes the same value. */
export function ownerGithubLogin(): string {
  return process.env.OWNER_GITHUB_LOGIN?.trim() || DEFAULT_OWNER_GITHUB_LOGIN;
}

/** The status description the workflow writes for a PR. */
export function stampDescription(prNumber: number): string {
  return `Owner approved #${prNumber}`;
}

/** The description names `#n` as a whole number (`#12` isn't `#123`). */
export function namesPr(description: string, n: number): boolean {
  const token = `#${n}`;
  for (let at = description.indexOf(token); at !== -1; at = description.indexOf(token, at + 1)) {
    const next = description[at + token.length] ?? "";
    if (!(next >= "0" && next <= "9")) return true;
  }
  return false;
}

export interface StampStatus {
  context: string;
  state: string;
  description: string | null;
  creator?: { login: string } | null;
}

/** A3's test of one commit status: the approval stamp for this PR, set by Actions. */
export function isApprovalStamp(status: StampStatus, prNumber: number): boolean {
  return (
    status.context === STAMP_CONTEXT &&
    status.state === "success" &&
    status.creator?.login === STAMP_CREATOR &&
    namesPr(status.description ?? "", prNumber)
  );
}
