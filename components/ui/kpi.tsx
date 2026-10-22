import { cn } from '@/lib/cn'

export function Kpi({
  label,
  value,
  sub,
  change,
  lowerIsBetter,
  tone,
  hint,
}: {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  change?: string | null
  lowerIsBetter?: boolean
  tone?: 'bad' | 'warn'
  hint?: string
}) {
  const up = change?.startsWith('+')
  const good = change && change !== '+0%' && change !== '0%' ? (lowerIsBetter ? !up : up) : null
  return (
    <div className="min-w-0 rounded-md border border-line/70 bg-ground/40 px-3 py-2.5" title={hint}>
      <div className="truncate text-xs text-muted">{label}</div>
      <div className={cn('num mt-0.5 text-lg font-semibold leading-tight', tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-meta text-muted">
        {change ? <span className={cn('num font-medium', good === true && 'text-ok', good === false && 'text-bad')}>{change}</span> : null}
        {sub ? <span>{sub}</span> : null}
      </div>
    </div>
  )
}
