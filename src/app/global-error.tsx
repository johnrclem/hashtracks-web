"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort error boundary — only fires when the ROOT layout itself throws
 * (e.g. a Clerk outage), so it must render its own <html>/<body> and cannot use
 * the app's providers. Tailwind is pulled in via the globals.css import so the
 * fallback still matches the site theme. Keep this minimal.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center text-foreground">
          <div className="text-5xl" aria-hidden="true">
            🏃
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            Check your six — we lost the trail.
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            A false trail led us off course (the site hit an unexpected error).
            Re-check and we’ll get you back to the pack.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={() => reset()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              On-On (try again)
            </button>
            {/* Plain <a>, not next/link: global-error replaces the crashed root
                layout and renders outside the Router context, so Link can't work. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Back to the pack
            </a>
          </div>
          {error.digest && (
            <p className="mt-2 select-all rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
              Trail ref: {error.digest}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
