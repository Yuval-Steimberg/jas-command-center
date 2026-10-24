/**
 * What a shop page looks like while it reads: its real title at once, then
 * placeholders in the shape of what is coming. A tap shows the next screen
 * immediately instead of leaving the last one frozen under the seller's thumb.
 */
export function ShopSkeleton({ title, rows = 4, form = false }: { title: string; rows?: number; form?: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true">
      <h1 className="text-2xl font-bold text-ink">{title}</h1>
      {form ? <div className="h-12 animate-pulse rounded-lg border border-line bg-surface" /> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {Array.from({ length: rows }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-lg border border-line bg-surface" />)}
      </div>
    </div>
  )
}
