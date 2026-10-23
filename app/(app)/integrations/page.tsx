import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { StatusBadge, StatusDot } from '@/components/ui/status'
import { CapabilityList } from '@/components/capabilities'
import { ADAPTERS } from '@/lib/integrations/registry'
import { liveHealth } from '@/lib/live'
import { requirePageAccess } from '@/lib/auth/session'
import { formatDateTime, timeAgo } from '@/lib/format'
import { getDeployments } from '@/lib/integrations/vercel/deployments'
import { SourceProblem } from '@/components/ui/source-state'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  await requirePageAccess('integrations:read')
  const [health, deployments] = await Promise.all([liveHealth(), getDeployments()])
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Each product connects through its own adapter. A check is green only when a live probe of the running service succeeded; a product that cannot be checked shows “Not checked”, never “Operational”."
      />
      <div className="flex flex-col gap-4">
        <div id="deployments">
          <Card>
            <CardHeader title="Production deployments" meta={deployments.state === 'ok' ? `Vercel · checked ${timeAgo(deployments.checkedAt)}` : 'Vercel'} />
            <CardBody>
              {deployments.state !== 'ok' ? (
                <SourceProblem result={deployments} what="Deployments" />
              ) : !deployments.data.length ? (
                <p className="text-sm text-muted">The token sees no production deployments. Check that VERCEL_TEAM_ID names the team the projects live in.</p>
              ) : (
                <ul className="divide-y divide-line/70">
                  {deployments.data.map((d) => (
                    <li key={d.project} className="grid gap-1 py-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="font-medium">{d.project}</div>
                        <div className="truncate text-xs text-muted" dir="auto">
                          {d.live ? <>Live since {formatDateTime(d.live.createdAt)}{d.live.commit ? ` · ${d.live.commit}` : ''}</> : 'No successful production deploy in the recent list'}
                        </div>
                        {d.latest !== d.live ? (
                          <div className={d.latestFailed ? 'text-xs text-bad' : 'text-xs text-muted'} dir="auto">
                            Newest attempt {d.latest.state.toLowerCase()} {timeAgo(d.latest.createdAt)}{d.latest.commit ? ` · ${d.latest.commit}` : ''}
                          </div>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-3 text-xs">
                        {d.failedLast24h ? <span className="text-bad">{d.failedLast24h} failed in 24 h</span> : null}
                        {d.latest.inspectorUrl ? <a href={d.latest.inspectorUrl} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">Open in Vercel</a> : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
        {ADAPTERS.map((a) => {
          const h = health.find((x) => x.product === a.product)!
          const cfg = a.config()
          return (
            <Card key={a.product}>
              <CardHeader title={a.name} meta={a.description} action={<StatusBadge status={h.status} />} />
              <CardBody className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
                <div className="flex flex-col gap-4">
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted">Checks</div>
                    <ul className="flex flex-col gap-1.5">
                      {h.checks.map((c) => (
                        <li key={c.name} className="flex items-start gap-2 text-sm">
                          <StatusDot status={c.status} />
                          <div className="min-w-0">
                            <span className="font-medium">{c.name}</span> <span className="text-muted">— {c.detail}</span>
                            <div className="text-meta text-faint">{c.checkedAt ? `${timeAgo(c.checkedAt)}${c.latencyMs != null ? ` · ${c.latencyMs} ms` : ''}` : 'not run'}</div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted">Configuration</div>
                    <ul className="flex flex-col gap-1 text-sm">
                      {[...cfg.required, ...cfg.optional.filter((o) => !cfg.required.includes(o))].map((v) => (
                        <li key={v} className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs">{v}{cfg.required.includes(v) ? '' : ' (optional)'}</span>
                          <span className={cfg.missing.includes(v) ? 'text-xs text-warn' : 'text-xs text-ok'}>{cfg.missing.includes(v) ? 'not set' : 'set'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-muted">Capabilities</div>
                  <CapabilityList items={a.capabilities()} />
                </div>
              </CardBody>
            </Card>
          )
        })}
      </div>
    </>
  )
}
