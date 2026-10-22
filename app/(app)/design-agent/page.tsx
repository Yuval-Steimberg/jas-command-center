import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { CapabilityList } from '@/components/capabilities'
import { designAgentAdapter, getDesignAgentHealthz, getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import { requirePageAccess, userCan } from '@/lib/auth/session'
import { formatCount, formatDateTime } from '@/lib/format'
import { RetryButton } from './retry-button'

export const dynamic = 'force-dynamic'

export default async function DesignAgentPage() {
  await requirePageAccess('design_agent:read')
  const [h, s, canOperate] = await Promise.all([getDesignAgentHealthz(), getDesignAgentStatus(), userCan('design_agent:operate')])
  return (
    <>
      <PageHeader
        title="WhatsApp design agent"
        description="whatssup-bot is the owner's design agent on WhatsApp and Telegram. It only answers allowlisted owner numbers, so there are no customer conversations to manage here; what matters operationally is its job queue and message delivery."
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="Service" meta={h.state === 'ok' ? <Freshness checkedAt={h.checkedAt} source={h.source} latencyMs={h.latencyMs} /> : undefined} />
          <CardBody>
            {h.state !== 'ok' ? (
              <SourceProblem result={h} what="Design agent /healthz" />
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {Object.entries(h.data.jobs).map(([k, v]) => <Kpi key={k} label={`Jobs ${k}`} value={formatCount(v)} tone={k === 'dead' && v > 0 ? 'warn' : undefined} />)}
                <Kpi label="Stuck (>10 min queued)" value={formatCount(h.data.stuck)} tone={h.data.stuck ? 'bad' : undefined} />
                <Kpi label="Running commit" value={<span className="font-mono text-sm">{h.data.version?.commit ?? '—'}</span>} sub={h.data.version?.branch ?? undefined} />
              </div>
            )}
          </CardBody>
        </Card>

        {s.state !== 'ok' ? (
          <SourceProblem result={s} what="Jobs, failures and projects" />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Dead jobs" meta="Exhausted every retry. Latest 20." />
              <CardBody>
                {s.data.dead.length ? (
                  <ul className="divide-y divide-line/70">
                    {s.data.dead.map((j) => (
                      <li key={j.id} className="flex items-start justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm"><span className="font-medium">{j.type}</span> <span className="text-muted">#{j.id} · {j.attempts} attempts · {formatDateTime(j.updated_at)}</span></div>
                          {j.err ? <div className="break-words text-xs text-muted">{j.err}</div> : null}
                        </div>
                        {canOperate ? <RetryButton jobId={j.id} type={j.type} /> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No dead jobs.</p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Failed outbound messages" meta="Latest 20" />
              <CardBody>
                {s.data.outbound_failed.length ? (
                  <ul className="divide-y divide-line/70">
                    {s.data.outbound_failed.map((m) => (
                      <li key={m.id} className="py-2 text-sm">
                        <div><span className="font-medium">{m.kind}</span> <span className="text-muted">· {formatDateTime(m.created_at)}</span></div>
                        {m.error ? <div className="break-words text-xs text-muted">{m.error}</div> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No failed sends.</p>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Jobs by type" />
              <CardBody>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted"><tr><th className="py-1 text-start font-medium">Type</th><th className="text-start font-medium">Status</th><th className="text-end font-medium">Count</th></tr></thead>
                  <tbody className="num">{s.data.jobs.map((j) => <tr key={`${j.type}:${j.status}`} className="border-t border-line/50"><td className="py-1.5">{j.type}</td><td>{j.status}</td><td className="text-end">{formatCount(j.c)}</td></tr>)}</tbody>
                </table>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Recent design projects" />
              <CardBody>
                {s.data.projects.length ? (
                  <ul className="divide-y divide-line/70">
                    {s.data.projects.map((p) => (
                      <li key={p.id} className="flex justify-between gap-3 py-2 text-sm">
                        <span className="min-w-0 truncate"><bdi>{p.title || `Project ${p.id}`}</bdi> <span className="text-muted">· {p.kind ?? '—'}</span></span>
                        <span className="shrink-0 text-xs text-muted">{p.status} · v{p.current_version ?? 0} · {formatDateTime(p.updated_at)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No design projects yet.</p>
                )}
              </CardBody>
            </Card>
          </div>
        )}
      </div>
      <Card className="mt-6">
        <CardHeader title="What this integration can do" />
        <CardBody>
          <CapabilityList items={designAgentAdapter.capabilities()} />
        </CardBody>
      </Card>
    </>
  )
}
