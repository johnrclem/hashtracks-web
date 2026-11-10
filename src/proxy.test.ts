vi.mock("@clerk/nextjs/server", () => ({
  clerkMiddleware: (handler: unknown) => handler,
  createRouteMatcher: () => () => false,
}));

import { config } from "./proxy";

// Next compiles each matcher as a full-path pattern; anchoring the string as a
// RegExp reproduces that for these plain-regex-group matchers.
const matchers = config.matcher.map((pattern) => new RegExp(`^${pattern}$`));
const runsMiddleware = (path: string) => matchers.some((re) => re.test(path));

describe("proxy matcher", () => {
  it.each([
    "/ingest/i/v0/e/",
    "/ingest/e/",
    "/ingest/flags/",
    "/ingest/decide",
    "/ingest/static/array.js",
  ])("lets PostHog proxy requests skip Clerk: %s", (path) => {
    expect(runsMiddleware(path)).toBe(false);
  });

  it.each(["/kennel-logos/krashh3.avif", "/_next/static/chunks/main.js", "/favicon.ico"])(
    "skips static files: %s",
    (path) => {
      expect(runsMiddleware(path)).toBe(false);
    },
  );

  it.each(["/", "/hareline", "/admin/alerts", "/logbook", "/api/health", "/ingestion-report"])(
    "still runs Clerk for app routes: %s",
    (path) => {
      expect(runsMiddleware(path)).toBe(true);
    },
  );
});
