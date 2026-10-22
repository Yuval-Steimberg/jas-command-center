export function Progress({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0
  return (
    <div className="min-w-[120px]">
      <div className="flex justify-between text-meta text-muted">
        <span>{label}</span>
        <span className="num">
          {value}/{total}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-sage-deep" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
