import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SCRIPT = path.resolve(__dirname, "safe-prisma.mjs");
const PROD_URL = "postgres://u:p@trolley.proxy.rlwy.net:18763/railway";
const LOCAL_URL = "postgres://u:p@localhost:5432/dev";
const DOCKER_URL = "postgres://u:p@host.docker.internal:5432/dev";
const COMPOSE_URL = "postgres://u:p@postgres:5432/dev";
const IPV6_URL = "postgres://u:p@[::1]:5432/dev";
const RANDOM_REMOTE_URL = "postgres://u:p@db.somewhere.example.com:5432/x";

// SAFE_PRISMA_SKIP_DOTENV=1 prevents the wrapper from loading .env / .env.local,
// so tests aren't sensitive to whatever DATABASE_URL the dev machine has set.
function run(args: string[], env: Record<string, string | undefined> = {}) {
  // Pass `DATABASE_URL: undefined` to delete the key (so the child sees it
  // truly unset); spawnSync would otherwise serialize it as the string
  // "undefined".
  const merged: Record<string, string | undefined> = {
    ...process.env,
    SAFE_PRISMA_DRY_RUN: "1",
    SAFE_PRISMA_SKIP_DOTENV: "1",
  };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  return spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf-8",
    env: merged as NodeJS.ProcessEnv,
  });
}

describe("safe-prisma wrapper", () => {
  describe("blocks destructive commands against non-local hosts", () => {
    it("blocks `migrate dev` against Railway prod host", () => {
      const r = run(["migrate", "dev", "--name", "foo"], {
        DATABASE_URL: PROD_URL,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Refusing/);
      expect(r.stderr).toMatch(/trolley\.proxy\.rlwy\.net/);
    });

    it("blocks `migrate reset` against prod host", () => {
      const r = run(["migrate", "reset"], { DATABASE_URL: PROD_URL });
      expect(r.status).toBe(1);
    });

    it("blocks `db push` against prod host", () => {
      const r = run(["db", "push"], { DATABASE_URL: PROD_URL });
      expect(r.status).toBe(1);
    });

    it("blocks `migrate dev` against an unknown remote host (fail-closed)", () => {
      const r = run(["migrate", "dev"], { DATABASE_URL: RANDOM_REMOTE_URL });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not on the local-safe allowlist/);
    });

    it("blocks destructive commands when DATABASE_URL is unset", () => {
      const r = run(["migrate", "dev"], { DATABASE_URL: "" });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not set/);
    });

    it("blocks destructive commands when DATABASE_URL is unparseable", () => {
      const r = run(["migrate", "dev"], { DATABASE_URL: "not-a-url" });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not a parseable URL/);
    });

    it("blocks destructive commands when DATABASE_URL is fully unset (no key)", () => {
      const r = run(["migrate", "dev"], { DATABASE_URL: undefined });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/not set/);
    });

    it("blocks `migrate dev` when --schema flag precedes the subcommand", () => {
      const r = run(
        ["--schema=./prisma/schema.prisma", "migrate", "dev"],
        { DATABASE_URL: PROD_URL },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Refusing/);
    });

    it("blocks `db execute` against prod host", () => {
      const r = run(["db", "execute", "--file", "./drop.sql"], {
        DATABASE_URL: PROD_URL,
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/Refusing/);
    });
  });

  describe("allows non-destructive commands against any host", () => {
    it("allows `migrate deploy` against prod", () => {
      const r = run(["migrate", "deploy"], { DATABASE_URL: PROD_URL });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/DRY RUN: npx prisma migrate deploy/);
    });

    it("allows `migrate resolve` against prod (rollback path)", () => {
      const r = run(["migrate", "resolve", "--rolled-back", "foo"], {
        DATABASE_URL: PROD_URL,
      });
      expect(r.status).toBe(0);
    });

    it("allows `db seed` against prod", () => {
      const r = run(["db", "seed"], { DATABASE_URL: PROD_URL });
      expect(r.status).toBe(0);
    });
  });

  describe("allows destructive commands against safe local hosts", () => {
    it("allows `migrate dev` against localhost", () => {
      const r = run(["migrate", "dev", "--name", "foo"], {
        DATABASE_URL: LOCAL_URL,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/DRY RUN/);
    });

    it("allows `migrate dev` against host.docker.internal", () => {
      const r = run(["migrate", "dev"], { DATABASE_URL: DOCKER_URL });
      expect(r.status).toBe(0);
    });

    it("allows `migrate dev` against docker-compose `postgres` service", () => {
      const r = run(["migrate", "dev"], { DATABASE_URL: COMPOSE_URL });
      expect(r.status).toBe(0);
    });

    it("allows `migrate dev` against IPv6 loopback", () => {
      const r = run(["migrate", "dev"], { DATABASE_URL: IPV6_URL });
      expect(r.status).toBe(0);
    });

    it("allows `db execute` against localhost", () => {
      const r = run(["db", "execute", "--file", "./seed.sql"], {
        DATABASE_URL: LOCAL_URL,
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/DRY RUN/);
    });
  });
});
