import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, it, expect } from "vitest";

/**
 * The Vercel build command gates `prisma migrate deploy` on VERCEL_ENV so
 * preview builds (which share the prod DATABASE_URL) never migrate prod
 * (PR #2675). These tests run the exact command string from vercel.json under
 * `sh` against stub `prisma` / `next` binaries that just log their arguments.
 */
const ROOT = path.resolve(__dirname, "..");
const BUILD_COMMAND: string = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf-8")).buildCommand;
const STUB_DIR = mkdtempSync(path.join(tmpdir(), "vercel-build-stubs-"));
const LOG = path.join(STUB_DIR, "calls.log");

for (const bin of ["prisma", "next"]) {
  const exitVar = `${bin.toUpperCase()}_STUB_EXIT`;
  writeFileSync(
    path.join(STUB_DIR, bin),
    `#!/bin/sh\necho "${bin} $*" >> "${LOG}"\nexit \${${exitVar}:-0}\n`,
  );
  chmodSync(path.join(STUB_DIR, bin), 0o755);
}

afterAll(() => rmSync(STUB_DIR, { recursive: true, force: true }));

function build(env: Record<string, string | undefined>) {
  rmSync(LOG, { force: true });
  const merged: Record<string, string | undefined> = {
    ...process.env,
    PATH: `${STUB_DIR}:${process.env.PATH ?? ""}`,
  };
  delete merged.VERCEL_ENV;
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete merged[k];
    else merged[k] = v;
  }
  const r = spawnSync("sh", ["-c", BUILD_COMMAND], { encoding: "utf-8", env: merged as NodeJS.ProcessEnv });
  let calls: string[] = [];
  try {
    calls = readFileSync(LOG, "utf-8").trim().split("\n").filter(Boolean);
  } catch {
    // no calls logged
  }
  return { status: r.status, stdout: r.stdout, calls };
}

describe("Vercel build command", () => {
  it("is the same command `npm run vercel-build` runs", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf-8"));
    expect(pkg.scripts["vercel-build"]).toBe(BUILD_COMMAND);
  });

  it("runs migrate deploy then next build on production", () => {
    const r = build({ VERCEL_ENV: "production" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(["prisma migrate deploy", "next build"]);
  });

  it("fails the build (and skips next build) when migrate deploy fails on production", () => {
    const r = build({ VERCEL_ENV: "production", PRISMA_STUB_EXIT: "1" });
    expect(r.status).not.toBe(0);
    expect(r.calls).toEqual(["prisma migrate deploy"]);
  });

  it.each(["preview", "development", undefined])(
    "never runs migrate deploy when VERCEL_ENV=%s",
    (vercelEnv) => {
      const r = build({ VERCEL_ENV: vercelEnv });
      expect(r.status).toBe(0);
      expect(r.calls).toEqual(["prisma migrate status", "next build"]);
      expect(r.stdout).toContain("skipping migrate deploy");
    },
  );

  it("keeps building a preview when migrate status reports pending migrations", () => {
    const r = build({ VERCEL_ENV: "preview", PRISMA_STUB_EXIT: "1" });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual(["prisma migrate status", "next build"]);
  });
});
