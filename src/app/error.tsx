"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Error boundary for everything below the root layout — renders inside the app
 * shell (Header, providers, theme) with hash-themed copy. Preserves Sentry
 * capture, the reset() retry, and the digest for support triage (#1711). The
 * root-layout-level fallback lives in global-error.tsx.
 */
export default function Error({
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
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="text-5xl" aria-hidden="true">
        🏃
      </div>
      <h1 className="text-2xl font-bold tracking-tight">
        False trail! The hare led us astray.
      </h1>
      <p className="text-sm text-muted-foreground">
        Something flagged this trail. Re-check it, or head back to a known
        checkpoint.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={() => reset()}>On-On (try again)</Button>
        <Button asChild variant="outline">
          <Link href="/">Back to the pack</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/hareline">Find the trail</Link>
        </Button>
      </div>
      {error.digest && (
        <p className="mt-2 select-all rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
          Trail ref: {error.digest}
        </p>
      )}
    </main>
  );
}
