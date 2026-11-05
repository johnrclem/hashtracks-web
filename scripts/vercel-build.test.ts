import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, it, expect } from "vitest";

const SCRIPT = path.resolve(__dirname, "vercel-build.mjs");

function run(vercelEnv: string | undefined) {
  const env: Record<string, string | undefined> = {
    ...process.env,
    VERCEL_BUILD_DRY_RUN: "1",
  };
  if (vercelEnv === undefined) delete env.VERCEL_ENV;
  else env.VERCEL_ENV = vercelEnv;
  return spawnSync("node", [SCRIPT], {
    encoding: "utf-8",
    env: env as NodeJS.ProcessEnv,
  });
}

describe("vercel-build", () => {
  it("runs migrate deploy then next build on production", () => {
    const r = run("production");
    expect(r.status).toBe(0);
    const lines = r.stdout.split("\n").filter((l) => l.startsWith("DRY RUN:"));
    expect(lines).toEqual([
      "DRY RUN: npx prisma migrate deploy",
      "DRY RUN: npx next build",
    ]);
  });

  it.each(["preview", "development"])(
    "never runs migrate deploy on %s builds",
    (vercelEnv) => {
      const r = run(vercelEnv);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("migrate deploy\n");
      expect(r.stdout).toContain(`skipping migrate deploy (VERCEL_ENV=${vercelEnv})`);
      const lines = r.stdout.split("\n").filter((l) => l.startsWith("DRY RUN:"));
      expect(lines).toEqual([
        "DRY RUN: npx prisma migrate status",
        "DRY RUN: npx next build",
      ]);
    },
  );

  it("treats an unset VERCEL_ENV (local run) as non-production", () => {
    const r = run(undefined);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("skipping migrate deploy (VERCEL_ENV=unset)");
    expect(r.stdout).not.toContain("DRY RUN: npx prisma migrate deploy");
  });
});
