import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sitemap.xml",
  "/robots.txt",
  // Extensionless metadata image routes: the matcher below only skips paths with
  // a known file extension, so these run through middleware and must be public or
  // Clerk's auth.protect() blocks them (manifest.webmanifest / favicon.ico are
  // excluded by extension; nested OG images ride the /kennels & /hareline patterns).
  "/icon",
  "/apple-icon",
  "/opengraph-image",
  "/api/health(.*)",
  "/api/cron(.*)",
  // Scheduled audit agent: no Clerk session. Every handler enforces the
  // AUDIT_AGENT_TOKEN bearer itself (src/lib/audit-agent-auth.ts).
  "/api/audit/agent/(.*)",
  "/api/auth/strava(.*)",
  "/kennels(.*)",
  "/hareline(.*)",
  "/invite(.*)",
  "/for-misman",
  "/about",
  "/suggest(.*)",
  "/monitoring(.*)",
  "/travel(.*)",
]);

export const proxy = clerkMiddleware(async (auth, request) => {
  // Cron routes use their own auth (QStash signature / CRON_SECRET) — skip Clerk
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/cron")) {
    return;
  }

  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files. NOTE: any NEW static extension
    // self-hosted under `public/` MUST be added to this alternation or requests
    // for it run through Clerk instead of the static CDN and 404 (the file exists
    // but never resolves) — that's why `.avif` kennel logos 404'd until added here.
    // `[.]` matches a literal dot without a backslash escape — a plain string
    // literal (required: Next statically analyzes this middleware matcher at
    // build time, so no String.raw/template expressions here) that also avoids
    // the escaped-backslash smell.
    // `ingest/` is the PostHog reverse proxy (rewritten in next.config.ts). It
    // must skip Clerk: otherwise auth.protect() rewrites every signed-out
    // visitor's analytics request to the 404 page and PostHog only ever sees
    // signed-in users.
    "/((?!_next|ingest/|[^?]*[.](?:html?|css|js(?!on)|jpe?g|webp|avif|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|xml|txt)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
