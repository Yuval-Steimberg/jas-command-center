import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { StatusBadge, StatusDot } from '@/components/ui/status'
import { CapabilityList } from '@/components/capabilities'
import { ADAPTERS } from '@/lib/integrations/registry'
import { liveHealth } from '@/lib/live'
import { requirePageAccess } from '@/lib/auth/session'
import { timeAgo } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function IntegrationsPage() {
  await requirePageAccess('integrations:read')
  const health = await liveHealth()
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Each product connects through its own adapter. A check is green only when a live probe of the running service succeeded; a product that cannot be checked shows “Not checked”, never “Operational”."
      />
      <div className="flex flex-col gap-4">
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
