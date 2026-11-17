import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron-auth", () => ({ verifyCronAuth: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { automationRun: { create: vi.fn(), update: vi.fn() } } }));

import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { scalarMetrics, withCronRun } from "./cron-run";

const create = vi.mocked(prisma.automationRun.create);
const update = vi.mocked(prisma.automationRun.update);
const request = () => new Request("https://www.hashtracks.xyz/api/cron/audit", { method: "POST" });

describe("withCronRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: true, method: "qstash" });
    create.mockResolvedValue({ id: "run-1" } as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects an unauthenticated request without running the job or recording a run", async () => {
    vi.mocked(verifyCronAuth).mockResolvedValue({ authenticated: false, method: "none" });
    const job = vi.fn();
    const res = await withCronRun("cron:audit", job)(request());
    expect(res.status).toBe(401);
    expect(job).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("records a successful run with the response's scalar metrics, and passes auth through", async () => {
    const job = vi.fn(async () =>
      NextResponse.json({ data: { dispatched: 120, failed: 0, success: true, results: [{ id: "x" }] } }),
    );
    const res = await withCronRun("cron:dispatch", job)(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { dispatched: 120 } });
    expect(job).toHaveBeenCalledWith(expect.any(Request), { authenticated: true, method: "qstash" });
    expect(create).toHaveBeenCalledWith({ data: { automation: "cron:dispatch", kind: "CRON" }, select: { id: true } });
    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({
        status: "SUCCESS",
        summary: null,
        metrics: { dispatched: 120, failed: 0, success: true },
        finishedAt: expect.any(Date),
      }),
    });
  });

  it("records the kind it is given", async () => {
    await withCronRun("cron:watchdog", async () => NextResponse.json({ data: {} }), { kind: "WATCHDOG" })(request());
    expect(create).toHaveBeenCalledWith({ data: { automation: "cron:watchdog", kind: "WATCHDOG" }, select: { id: true } });
  });

  it("records an error response as FAILED with its error as the summary", async () => {
    const res = await withCronRun("cron:dispatch", async () =>
      NextResponse.json({ data: null, error: "QStash client setup failed" }, { status: 500 }),
    )(request());
    expect(res.status).toBe(500);
    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "FAILED", summary: "QStash client setup failed" }),
    });
  });

  it("records a partial (207) response as SUCCESS, noting the status", async () => {
    await withCronRun("cron:sync-audit-issues", async () => NextResponse.json({ data: {} }, { status: 207 }))(request());
    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "SUCCESS", summary: "HTTP 207" }),
    });
  });

  it("sends a thrown error to Sentry, records FAILED and answers 500", async () => {
    const boom = new Error("audit query timed out");
    const res = await withCronRun("cron:audit", async () => {
      throw boom;
    })(request());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ data: null, error: "audit query timed out" });
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, { tags: { automation: "cron:audit" } });
    expect(update).toHaveBeenCalledWith({
      where: { id: "run-1" },
      data: expect.objectContaining({ status: "FAILED", summary: "audit query timed out" }),
    });
  });

  it("still runs the job when the run row can't be written", async () => {
    create.mockRejectedValue(new Error("db down"));
    const job = vi.fn(async () => NextResponse.json({ data: { deleted: 3 } }));
    const res = await withCronRun("cron:scrape-log-gc", job)(request());
    expect(res.status).toBe(200);
    expect(job).toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});

describe("scalarMetrics", () => {
  it("keeps numbers, booleans, null and trimmed strings from `data`, nothing nested", () => {
    expect(
      scalarMetrics({ data: { n: 1, ok: false, none: null, s: "x".repeat(300), list: [1], obj: { a: 1 } } }),
    ).toEqual({ n: 1, ok: false, none: null, s: "x".repeat(200) });
  });

  it("returns null for bodies without a usable `data` object", () => {
    expect(scalarMetrics(null)).toBeNull();
    expect(scalarMetrics({ data: null })).toBeNull();
    expect(scalarMetrics({ data: [1, 2] })).toBeNull();
    expect(scalarMetrics({ data: { list: [] } })).toBeNull();
  });
});
