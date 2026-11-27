export default function KennelsLoading() {
  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="h-8 w-48 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
        </div>
        <div className="h-9 w-36 animate-pulse rounded bg-muted" />
      </div>

      <div className="mt-6 space-y-4">
        {/* Search + sort row */}
        <div className="flex gap-3">
          <div className="h-9 w-80 animate-pulse rounded bg-muted" />
          <div className="h-9 w-44 animate-pulse rounded bg-muted" />
        </div>

        {/* Filter bar */}
        <div className="flex gap-2">
          <div className="h-8 w-20 animate-pulse rounded bg-muted" />
          <div className="flex gap-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-7 w-10 animate-pulse rounded bg-muted" />
            ))}
          </div>
          <div className="h-8 w-24 animate-pulse rounded bg-muted" />
          <div className="h-8 w-28 animate-pulse rounded bg-muted" />
        </div>

        {/* Results count */}
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />

        {/* Region heading */}
        <div className="h-6 w-40 animate-pulse rounded bg-muted" />

        {/* Card grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="h-5 w-24 animate-pulse rounded bg-muted" />
                  <div className="mt-1 h-4 w-48 animate-pulse rounded bg-muted" />
                </div>
                <div className="h-5 w-10 animate-pulse rounded-full bg-muted" />
              </div>
              <div className="mt-2 h-3 w-40 animate-pulse rounded bg-muted" />
              <div className="mt-2 h-3 w-full animate-pulse rounded bg-muted" />
              <div className="mt-1 h-3 w-3/4 animate-pulse rounded bg-muted" />
              <div className="mt-3 border-t pt-2">
                <div className="h-3 w-32 animate-pulse rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
