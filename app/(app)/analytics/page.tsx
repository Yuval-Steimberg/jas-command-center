import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { requireUser } from '@/lib/auth/session'
import { METRICS } from '@/lib/metrics-catalog'

export const dynamic = 'force-dynamic'

export default async function AnalyticsPage() {
  await requireUser()
  return (
    <>
      <PageHeader
        title="Analytics"
        description="The cross-product workspace (drill-downs, comparisons, exports) is the next phase. What exists now is the metrics catalogue every number in the command center is held to: one definition, one source, one refresh interval."
      />
      <Card>
        <CardHeader title="Metrics catalogue" meta={`${METRICS.length} metrics`} />
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-xs text-muted">
              <tr><th className="py-1 text-start font-medium">Metric</th><th className="text-start font-medium">Definition</th><th className="text-start font-medium">Source</th><th className="text-start font-medium">Refresh</th></tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.id} className="border-t border-line/50 align-top">
                  <td className="py-2 pe-3 font-medium">{m.label}</td>
                  <td className="py-2 pe-3 text-muted">{m.definition}</td>
                  <td className="py-2 pe-3 text-xs">{m.source}</td>
                  <td className="py-2 text-xs text-muted">{m.refresh}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      <p className="mt-3 text-xs text-muted">
        Populations are kept apart on purpose: website visitors, design-agent users and furniture workers are different people counted different ways, and there is no verified identity link between them.
      </p>
    </>
  )
}
