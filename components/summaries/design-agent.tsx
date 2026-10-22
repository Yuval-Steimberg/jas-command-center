import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getDesignAgentHealthz, getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import { formatCount } from '@/lib/format'

export async function DesignAgentSummary() {
  const [h, s] = await Promise.all([getDesignAgentHealthz(), getDesignAgentStatus()])
  return (
    <Card>
      <CardHeader
        title={<Link href="/design-agent" className="hover:underline">WhatsApp design agent</Link>}
        meta={h.state === 'ok' ? <Freshness checkedAt={h.checkedAt} source={h.source} latencyMs={h.latencyMs} /> : 'whatssup-bot'}
      />
      <CardBody className="flex flex-col gap-2">
        {h.state !== 'ok' ? (
          <SourceProblem result={h} what="Design agent service" />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Kpi label="Queued jobs" value={formatCount(h.data.jobs.queued ?? 0)} sub={h.data.stuck ? `${h.data.stuck} stuck >10 min` : 'none stuck'} tone={h.data.stuck ? 'bad' : undefined} />
            <Kpi label="Running" value={formatCount(h.data.jobs.running ?? 0)} />
            <Kpi label="Dead jobs" value={formatCount(h.data.jobs.dead ?? 0)} tone={(h.data.jobs.dead ?? 0) > 0 ? 'warn' : undefined} />
          </div>
        )}
        {s.state === 'ok' ? (
          <p className="text-xs text-muted">{s.data.outbound_failed.length ? `${s.data.outbound_failed.length} failed outbound message(s) in the latest 20.` : 'No failed outbound messages.'}</p>
        ) : s.state === 'not_configured' ? (
          <p className="text-xs text-muted">Failure details need {s.missing.join(', ')}.</p>
        ) : (
          <SourceProblem result={s} what="Job details" />
        )}
      </CardBody>
    </Card>
  )
}
