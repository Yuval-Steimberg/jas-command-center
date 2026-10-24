/** Shop mode streams a skeleton at once while a page reads, instead of a frozen screen at the counter. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <div className="h-8 w-40 animate-pulse rounded bg-sunken" />
      <div className="flex flex-col gap-3">
        <div className="min-h-20 animate-pulse rounded-lg bg-sunken" />
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="min-h-24 animate-pulse rounded-lg border border-line bg-surface" />)}
        </div>
      </div>
      <div className="h-24 animate-pulse rounded-lg border border-line bg-surface" />
    </div>
  )
}
