/** Shop mode streams a skeleton at once while a page reads, instead of a frozen screen at the counter. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="h-7 w-24 animate-pulse rounded bg-sunken" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="min-h-28 animate-pulse rounded-lg border border-line bg-surface" />)}
      </div>
      <div className="h-32 animate-pulse rounded-lg border border-line bg-surface" />
    </div>
  )
}
