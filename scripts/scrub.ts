/**
 * Scrub text before a scheduled task posts it to GitHub: a comment, a PR body, an issue body.
 *
 *   npx tsx scripts/scrub.ts < body.md > body.clean.md
 *   npx tsx scripts/scrub.ts --kennel-website https://example-h3.org < body.md > body.clean.md
 *   npx tsx scripts/scrub.ts --secrets-only < handoff.md > handoff.clean.md
 *
 * The repo is public and GitHub keeps edit history, so anything posted once stays public. Agents
 * paste output from local fetches into what they post, and those fetches run with the keys in the
 * Mac's `.env`: the Google Calendar and Sheets adapters, for one, put the API key in request URLs.
 * The server scrubs what it files itself; what an agent posts with `gh` never passes through it.
 *
 * Removes:
 * - **secrets** (always): credentials in URLs, query values whose name ends in key, token, sig,
 *   signature, secret or password, `.env`-style `NAME_KEY=value` assignments, Google API keys
 *   (`AIza…`), bearer tokens, GitHub tokens and Clerk/Stripe-style `sk_live_`/`sk_test_` keys;
 * - **personal data** (unless `--secrets-only`): phone numbers and email addresses.
 *   `--kennel-website` keeps addresses on that kennel's own domain, as the server does.
 *
 * Both come from `src/lib/audit-redact.ts`, the filter the server applies to everything it posts,
 * so this CLI and the server can't drift apart.
 *
 * `--secrets-only` is for files committed as data, such as a handoff, whose kennel contact details
 * are meant to be there.
 *
 * Prints the scrubbed text on stdout and the number of removals on stderr. Exit 2 on bad usage.
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { scrubForGitHub, scrubSecrets } from "@/lib/audit-redact";

export interface ScrubOptions {
  /** The kennel's website; an email address on its domain is kept. */
  kennelWebsite?: string | null;
  /** Remove secrets only, and keep phone numbers and email addresses. */
  secretsOnly?: boolean;
}

/** Remove secrets, then (unless `secretsOnly`) phone numbers and email addresses. */
export function scrub(text: string, options: ScrubOptions = {}): { text: string; removals: number } {
  if (options.secretsOnly) return scrubSecrets(text);
  const { text: scrubbed, redactions } = scrubForGitHub(text, options.kennelWebsite);
  return { text: scrubbed, removals: redactions };
}

const USAGE =
  "usage: npx tsx scripts/scrub.ts [--kennel-website <url>] [--secrets-only] < input > output";

/** Parse the CLI arguments; `null` means bad usage. */
export function parseArgs(args: readonly string[]): ScrubOptions | null {
  const options: ScrubOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--secrets-only") {
      options.secretsOnly = true;
    } else if (arg === "--kennel-website" && args[i + 1] && !args[i + 1].startsWith("--")) {
      options.kennelWebsite = args[i + 1];
      i += 1;
    } else if (arg.startsWith("--kennel-website=") && arg.length > "--kennel-website=".length) {
      options.kennelWebsite = arg.slice("--kennel-website=".length);
    } else {
      return null;
    }
  }
  return options;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  // A terminal on stdin means nothing was piped in; say how to use it rather than wait.
  if (!options || process.stdin.isTTY) {
    console.error(USAGE);
    process.exit(2);
  }
  const { text, removals } = scrub(await readStdin(), options);
  process.stdout.write(text);
  console.error(`scrub: removed ${removals} item(s)`);
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
