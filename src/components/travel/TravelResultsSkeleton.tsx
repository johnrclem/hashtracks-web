export function TravelResultsSkeleton() {
  return (
    <div className="mt-8 animate-pulse space-y-8">
      {/* Trip summary skeleton */}
      <div className="border-b border-border pb-8">
        <div className="h-10 w-64 rounded-lg bg-muted" />
        <div className="mt-4 h-1 w-28 rounded bg-muted" />
        <div className="mt-5 h-5 w-96 rounded bg-muted" />
        <div className="mt-3 h-3 w-48 rounded bg-muted" />
        <div className="mt-6 flex gap-3">
          <div className="h-8 w-24 rounded-md bg-muted" />
          <div className="h-8 w-20 rounded-md bg-muted" />
          <div className="h-8 w-32 rounded-md bg-muted" />
        </div>
      </div>

      {/* Distance tier skeleton */}
      <div>
        <div className="mb-4 flex items-baseline gap-3 border-b border-border pb-2">
          <div className="h-5 w-36 rounded bg-muted" />
          <div className="h-3 w-24 rounded bg-muted" />
        </div>

        <div className="space-y-4">
          {/* Confirmed card skeleton */}
          {[0, 1].map((i) => (
            <div key={`confirmed-${i}`} className="rounded-xl border border-border p-4">
              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-56 rounded bg-muted" />
                  <div className="h-3 w-40 rounded bg-muted" />
                </div>
                <div className="h-6 w-24 rounded-full bg-muted" />
              </div>
            </div>
          ))}

          {/* Likely card skeleton */}
          {[0, 1].map((i) => (
            <div key={`likely-${i}`} className="rounded-xl border border-border p-4">
              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-full bg-muted" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-48 rounded bg-muted" />
                  <div className="h-3 w-36 rounded bg-muted" />
                </div>
                <div className="h-6 w-32 rounded-full bg-muted" />
              </div>
              {/* Evidence timeline skeleton */}
              <div className="mt-4 rounded-lg bg-muted/50 p-3">
                <div className="h-2 w-28 rounded bg-muted mb-2" />
                <div className="flex gap-1.5">
                  {Array.from({ length: 12 }).map((_, j) => (
                    <div key={j} className="h-2 w-2 rounded-full bg-muted" />
                  ))}
                </div>
                <div className="mt-2 h-px w-full bg-muted" />
                <div className="mt-1.5 h-2 w-36 rounded bg-muted" />
              </div>
              {/* Explanation skeleton */}
              <div className="mt-3 rounded-lg bg-muted/30 p-3">
                <div className="h-2 w-24 rounded bg-muted mb-1" />
                <div className="h-3 w-full rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
