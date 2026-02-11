export default function KennelDetailLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-9 w-64 animate-pulse rounded bg-muted" />
        <div className="mt-2 h-5 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-3 flex gap-2">
          <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
          <div className="h-5 w-12 animate-pulse rounded-full bg-muted" />
          <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        </div>
      </div>

      <div className="h-9 w-28 animate-pulse rounded bg-muted" />

      {/* Upcoming Events skeleton */}
      <div>
        <div className="mb-3 h-6 w-40 animate-pulse rounded bg-muted" />
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-lg border p-4">
              <div className="flex items-center gap-3">
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
                <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
              </div>
              <div className="mt-2 h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
