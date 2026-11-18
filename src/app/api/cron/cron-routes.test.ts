/**
 * Every cron route records its runs for the ops watchdog: it is wrapped in `withCronRun()` with
 * an id registered in `CRON_JOBS`, and every registered cron has a route. Adding a cron without
 * both fails here.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { CRON_JOBS } from "@/lib/automation-registry";

const CRON_DIR = path.join(process.cwd(), "src/app/api/cron");
/** Runs ~480 times a day; ScrapeLog records it. */
const UNWRAPPED = new Set(["scrape"]);

const routes = readdirSync(CRON_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !UNWRAPPED.has(d.name))
  .map((d) => ({ name: d.name, source: readFileSync(path.join(CRON_DIR, d.name, "route.ts"), "utf8") }));

const wrappedId = (source: string) => /withCronRun\(\s*"([^"]+)"/.exec(source)?.[1];

describe("cron routes and the automation registry", () => {
  it.each(routes.map((r) => [r.name, r.source]))("%s is wrapped in withCronRun with its registered id", (name, source) => {
    expect(wrappedId(source)).toBe(`cron:${name}`);
    expect(CRON_JOBS.map((j) => j.id)).toContain(`cron:${name}`);
    expect(source).toMatch(/export const GET = POST;/);
  });

  it("every registered cron has a route", () => {
    const routeIds = new Set(routes.map((r) => `cron:${r.name}`));
    expect(CRON_JOBS.map((j) => j.id).filter((id) => !routeIds.has(id))).toEqual([]);
  });

  it("every registered cron has a Vercel schedule (the backstop for QStash ones)", () => {
    const vercel = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as {
      crons: Array<{ path: string }>;
    };
    const scheduled = new Set(vercel.crons.map((c) => c.path));
    expect(CRON_JOBS.map((j) => `/api/cron/${j.id.slice("cron:".length)}`).filter((p) => !scheduled.has(p))).toEqual([]);
  });
});
