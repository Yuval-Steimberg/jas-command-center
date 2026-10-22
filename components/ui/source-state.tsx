import { PlugZap, TriangleAlert } from 'lucide-react'
import type { SourceResult } from '@/lib/integrations/types'
import { timeAgo } from '@/lib/format'

/** Renders the two non-data states of a source. Never a zero, never a blank. */
export function SourceProblem({ result, what }: { result: Exclude<SourceResult<unknown>, { state: 'ok' }>; what: string }) {
  if (result.state === 'not_configured') {
    return (
      <div className="flex gap-3 rounded-md border border-dashed border-line bg-sunken/60 p-3 text-sm">
        <PlugZap aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
        <div>
          <p className="font-medium text-ink">{what}: not connected</p>
          <p className="mt-0.5 text-muted">
            Needs <span className="font-mono text-xs">{result.missing.join(', ')}</span> on the command center deployment.
          </p>
          {result.note ? <p className="mt-1 text-xs text-muted">{result.note}</p> : null}
        </div>
      </div>
    )
  }
  return (
    <div role="alert" className="flex gap-3 rounded-md border border-bad/30 bg-bad/5 p-3 text-sm">
      <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-bad" />
      <div className="min-w-0">
        <p className="font-medium text-ink">{what}: could not load</p>
        <p className="mt-0.5 break-words text-muted">{result.error}</p>
        <p className="mt-1 text-meta text-faint">Tried {timeAgo(result.checkedAt)}</p>
      </div>
    </div>
  )
}

export function Freshness({ checkedAt, source, latencyMs }: { checkedAt: string; source: string; latencyMs?: number | null }) {
  return (
    <span title={source}>
      Updated {timeAgo(checkedAt)}
      {latencyMs != null ? ` · ${latencyMs} ms` : ''}
    </span>
  )
}
