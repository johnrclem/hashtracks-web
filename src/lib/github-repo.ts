/**
 * Shared GitHub repo validation for modules that POST to the GitHub API.
 *
 * Every caller used to triplicate `REPO_PATTERN` + `getRepo()` to kill the
 * Codacy taint flow from `process.env.GITHUB_REPOSITORY` into fetch URLs.
 * Centralized here so adding new GitHub writers doesn't require copying
 * the same six lines and regex.
 */

/** Production repo slug. Exported for display-only callers (prompt builders,
 *  href targets) that don't need env-driven overrides. */
export const HASHTRACKS_REPO = "johnrclem/hashtracks-web";

const DEFAULT_REPO = HASHTRACKS_REPO;
const REPO_PATTERN = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/;

/** Read GITHUB_REPOSITORY from env, validate the `owner/name` shape, return it. */
export function getValidatedRepo(): string {
  const value = process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;
  if (!REPO_PATTERN.test(value)) {
    throw new Error(`Invalid GITHUB_REPOSITORY format: ${value}`);
  }
  return value;
}
