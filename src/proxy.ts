import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sitemap.xml",
  "/robots.txt",
  "/api/health(.*)",
  "/api/cron(.*)",
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
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|xml|txt)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
