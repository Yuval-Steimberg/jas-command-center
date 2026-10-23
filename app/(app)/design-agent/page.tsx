import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { CapabilityList } from '@/components/capabilities'
import { designAgentAdapter, getDesignAgentHealthz, getDesignAgentOs, getDesignAgentStatus } from '@/lib/integrations/design-agent/adapter'
import { env } from '@/lib/env'
import { requirePageAccess, userCan } from '@/lib/auth/session'
import { formatCount, formatDateTime } from '@/lib/format'
import { RetryButton } from './retry-button'

export const dynamic = 'force-dynamic'

export default async function DesignAgentPage() {
  await requirePageAccess('design_agent:read')
  const [h, s, os, canOperate] = await Promise.all([getDesignAgentHealthz(), getDesignAgentStatus(), getDesignAgentOs(), userCan('design_agent:operate')])
  const ccUrl = env().designAgent.url ? `${env().designAgent.url}/cc` : null
  const usd = (n: number | null) => (n == null ? '—' : `$${n.toFixed(2)}`)
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

        <Card>
          <CardHeader
            title="Business OS"
            meta={os.state === 'ok' ? <Freshness checkedAt={os.checkedAt} source={os.source} latencyMs={os.latencyMs} /> : undefined}
          />
          <CardBody>
            {os.state !== 'ok' ? (
              <SourceProblem result={os} what="Approvals, automations and AI cost" />
            ) : !os.data.available ? (
              <p className="text-sm text-muted">The bot&apos;s business OS has not been set up on this deployment, so there are no approvals, automations or AI cost to show.</p>
            ) : (
              <div className="flex flex-col gap-5">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Kpi label="Approvals waiting" value={formatCount(os.data.approvals.pending.length)} tone={os.data.approvals.pending.length ? 'warn' : undefined} />
                  <Kpi
                    label="AI cost this month"
                    value={usd(os.data.costs.total_usd)}
                    sub={os.data.costs.budget_usd ? `${os.data.costs.budget_used_pct ?? 0}% of ${usd(os.data.costs.budget_usd)}` : 'no budget set'}
                    tone={os.data.costs.budget_used_pct != null && os.data.costs.budget_used_pct >= 90 ? 'bad' : undefined}
                  />
                  <Kpi label="Model calls this month" value={formatCount(os.data.costs.calls)} />
                  <Kpi
                    label="Automations failing"
                    value={formatCount(os.data.automations.list.filter((a) => a.last_status === 'failed').length)}
                    sub={os.data.automations.enabled_globally ? undefined : 'automations are off globally'}
                    tone={os.data.automations.list.some((a) => a.last_status === 'failed') ? 'bad' : undefined}
                  />
                </div>
                <div>
                  <h3 className="mb-1 text-sm font-semibold">Manager approvals waiting</h3>
                  {os.data.approvals.pending.length ? (
                    <ul className="divide-y divide-line/70">
                      {os.data.approvals.pending.map((a) => (
                        <li key={a.id} className="py-2 text-sm">
                          <div><span className="font-medium">{a.agent} · {a.action}</span> <span className="text-muted">#{a.id} · level {a.level} · {formatDateTime(a.created_at)}</span></div>
                          {a.summary ? <div className="break-words text-xs text-muted"><bdi>{a.summary}</bdi></div> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-muted">Nothing is waiting for approval.</p>
                  )}
                  {os.data.approvals.pending.length && ccUrl ? (
                    <p className="mt-2 text-xs text-muted">
                      Approvals are decided in the bot&apos;s own Control Center, where each one is bound to the exact action it runs:{' '}
                      <a className="underline underline-offset-2" href={ccUrl} target="_blank" rel="noopener noreferrer">open it</a>.
                    </p>
                  ) : null}
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <h3 className="mb-1 text-sm font-semibold">Automations</h3>
                    {os.data.automations.list.length ? (
                      <ul className="divide-y divide-line/70">
                        {os.data.automations.list.map((a) => (
                          <li key={a.key} className="py-2 text-sm">
                            <div className="flex justify-between gap-3">
                              <span className="min-w-0 truncate"><bdi>{a.name}</bdi></span>
                              <span className="shrink-0 text-xs text-muted">{a.enabled ? 'on' : 'off'}{a.last_status ? ` · last ${a.last_status}` : ''}</span>
                            </div>
                            <div className="text-xs text-muted">
                              {a.last_run_at ? `Last run ${formatDateTime(a.last_run_at)}` : 'Never run'}
                              {a.next_run_at ? ` · next ${formatDateTime(a.next_run_at)}` : ''}
                            </div>
                            {a.last_status === 'failed' && a.last_error ? <div className="break-words text-xs text-muted">{a.last_error}</div> : null}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted">No automations defined.</p>
                    )}
                  </div>
                  <div>
                    <h3 className="mb-1 text-sm font-semibold">AI cost by source, this month</h3>
                    {os.data.costs.by_source.length ? (
                      <table className="w-full text-sm">
                        <thead className="text-xs text-muted"><tr><th className="py-1 text-start font-medium">Source</th><th className="text-end font-medium">Calls</th><th className="text-end font-medium">USD</th></tr></thead>
                        <tbody className="num">
                          {os.data.costs.by_source.map((c) => (
                            <tr key={`${c.source}:${c.agent}`} className="border-t border-line/50"><td className="py-1.5">{c.source}{c.agent !== '-' ? ` · ${c.agent}` : ''}</td><td className="text-end">{formatCount(c.calls)}</td><td className="text-end">{usd(c.usd)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-muted">No model calls this month.</p>
                    )}
                    <p className="mt-2 text-xs text-muted">{os.data.costs.note}</p>
                  </div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
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
