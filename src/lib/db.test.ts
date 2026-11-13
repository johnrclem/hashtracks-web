const poolInstances: Array<{ options: Record<string, unknown>; on: ReturnType<typeof vi.fn> }> = [];

vi.mock("pg", () => ({
  Pool: vi.fn(function Pool(this: { options: Record<string, unknown>; on: ReturnType<typeof vi.fn> }, options: Record<string, unknown>) {
    this.options = options;
    this.on = vi.fn();
    poolInstances.push(this);
  }),
}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: vi.fn() }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: vi.fn() }));
vi.mock("@vercel/functions/db-connections", () => ({ attachDatabasePool: vi.fn() }));

import { attachDatabasePool } from "@vercel/functions/db-connections";

const globalCache = globalThis as unknown as { prisma?: unknown };

describe("prisma singleton", () => {
  beforeEach(() => {
    vi.resetModules();
    poolInstances.length = 0;
    vi.mocked(attachDatabasePool).mockClear();
    delete globalCache.prisma;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete globalCache.prisma;
  });

  it("reuses one client across module evaluations in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const first = (await import("./db")).prisma;
    vi.resetModules();
    const second = (await import("./db")).prisma;

    expect(second).toBe(first);
    expect(poolInstances).toHaveLength(1);
    expect(poolInstances[0].options).toMatchObject({ max: 2, idleTimeoutMillis: 10_000 });
  });

  it("attaches the pool for idle release and handles idle-client errors", async () => {
    await import("./db");

    expect(attachDatabasePool).toHaveBeenCalledWith(poolInstances[0]);
    expect(poolInstances[0].on).toHaveBeenCalledWith("error", expect.any(Function));
  });
});
