export default function HarelineLoading() {
  return (
    <div>
      <div>
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
      </div>

      <div className="mt-6 space-y-4">
        {/* Controls bar placeholder */}
        <div className="flex items-center justify-between">
          <div className="h-9 w-44 animate-pulse rounded bg-muted" />
          <div className="flex gap-2">
            <div className="h-9 w-32 animate-pulse rounded bg-muted" />
            <div className="h-9 w-36 animate-pulse rounded bg-muted" />
          </div>
        </div>

        {/* Filter bar placeholder */}
        <div className="flex gap-2">
          <div className="h-9 w-28 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded bg-muted" />
          <div className="h-9 w-28 animate-pulse rounded bg-muted" />
        </div>

        {/* Results count */}
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />

        {/* Event card skeletons */}
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
                <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
              </div>
              <div className="mt-2 h-4 w-64 animate-pulse rounded bg-muted" />
              <div className="mt-1 h-3 w-40 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
