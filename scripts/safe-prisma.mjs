#!/usr/bin/env node
import dotenv from "dotenv";
import { spawnSync } from "node:child_process";

// Skip env-file loading when running under tests so they're deterministic on
// dev machines that already have a populated `.env.local`.
if (process.env.SAFE_PRISMA_SKIP_DOTENV !== "1") {
  // No `override:` — both calls leave already-set vars (incl. shell env) alone.
  // `.env.local` is loaded first so it wins over `.env` when both define a key.
  // Matches Next.js semantics: shell > .env.local > .env.
  dotenv.config({ path: ".env.local" });
  dotenv.config();
}

const args = process.argv.slice(2);

function isDestructive(argv) {
  // Strip flags so "--schema=foo migrate dev" and "migrate --schema=foo dev"
  // both reduce to ["migrate", "dev"]. Prisma's CLI accepts intermixed flags,
  // so the guard has to as well.
  const positional = argv.filter((a) => !a.startsWith("-"));
  const [cmd, sub] = positional;
  if (cmd === "migrate" && (sub === "dev" || sub === "reset")) return true;
  // `db execute` runs arbitrary SQL via --file/--stdin against the datasource.
  if (cmd === "db" && (sub === "push" || sub === "execute")) return true;
  return false;
}

// Hostnames that are unambiguously local/dev. Bare names like `postgres`/`db`
// are docker-compose service names — they only resolve inside a container
// network, so a remote host literally named `postgres` is not reachable from
// a normal dev shell. Anything not on this list is treated as potentially
// production and blocked (fail-closed).
const SAFE_LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "host.docker.internal",
  "postgres",
  "db",
]);

function refuse(reason, extra = "") {
  const RED = "\x1b[31m";
  const RESET = "\x1b[0m";
  process.stderr.write(
    `${RED}❌ Refusing to run destructive Prisma command.${RESET}\n` +
      `   command: prisma ${args.join(" ")}\n` +
      `   reason:  ${reason}\n` +
      (extra ? `   ${extra}\n` : "") +
      `   Set DATABASE_URL to a known-local Postgres host before re-running.\n` +
      `   Allowed local hosts: ${[...SAFE_LOCAL_HOSTS].join(", ")}\n` +
      `   See .claude/rules/database.md.\n`,
  );
  process.exit(1);
}

if (isDestructive(args)) {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) {
    refuse("DATABASE_URL is not set (cannot verify target is local)");
  }

  let hostname;
  try {
    hostname = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    refuse(
      "DATABASE_URL is not a parseable URL (cannot verify target is local)",
    );
  }

  if (!SAFE_LOCAL_HOSTS.has(hostname)) {
    refuse(
      `DATABASE_URL host "${hostname}" is not on the local-safe allowlist`,
      `(destructive Prisma commands are blocked unless host is local)`,
    );
  }
}

if (process.env.SAFE_PRISMA_DRY_RUN === "1") {
  process.stdout.write(`DRY RUN: npx prisma ${args.join(" ")}\n`);
  process.exit(0);
}

const result = spawnSync("npx", ["prisma", ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
