export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-card" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-32 animate-pulse rounded bg-sunken" />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {Array.from({ length: rows * 2 }).map((_, i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-sunken/70" />
        ))}
      </div>
    </div>
  )
}
