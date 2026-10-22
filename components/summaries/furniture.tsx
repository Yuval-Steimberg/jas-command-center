import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { formatCount } from '@/lib/format'

export async function FurnitureSummary() {
  const r = await getFurnitureProjects()
  return (
    <Card>
      <CardHeader
        title={<Link href="/furniture" className="hover:underline">Furniture collection</Link>}
        meta={r.state === 'ok' ? <><span>Active projects</span> · <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /></> : 'Furniture-Collect'}
      />
      <CardBody>
        {r.state !== 'ok' ? (
          <SourceProblem result={r} what="Furniture projects" />
        ) : (
          (() => {
            const active = r.data.filter((p) => !p.archived)
            const sum = (f: (p: (typeof active)[number]) => number) => active.reduce((a, p) => a + f(p), 0)
            const apts = sum((p) => p.apartments)
            const done = sum((p) => p.apartmentsCompleted)
            const toCollect = sum((p) => p.itemsToCollect)
            const collected = sum((p) => p.itemsCollected)
            return (
              <div className="grid grid-cols-2 gap-2">
                <Kpi label="Active projects" value={formatCount(active.length)} sub={`${formatCount(r.data.length - active.length)} archived`} />
                <Kpi label="Apartments completed" value={`${formatCount(done)} / ${formatCount(apts)}`} />
                <Kpi label="Items recorded" value={formatCount(sum((p) => p.items))} />
                <Kpi label="Items collected" value={`${formatCount(collected)} / ${formatCount(toCollect)}`} sub="of items marked for collection" />
              </div>
            )
          })()
        )}
      </CardBody>
    </Card>
  )
}
