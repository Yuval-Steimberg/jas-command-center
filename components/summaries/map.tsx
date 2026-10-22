import Link from 'next/link'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { getMapData } from '@/lib/integrations/map/adapter'

export async function MapSummary() {
  const r = await getMapData()
  return (
    <Card>
      <CardHeader
        title={<Link href="/map" className="hover:underline">Interactive map</Link>}
        meta={r.state === 'ok' ? <Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> : 'Interactive-map'}
      />
      <CardBody>
        {r.state !== 'ok' ? (
          <SourceProblem result={r} what="Map places" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Kpi label="Places on the route" value={r.data.places.length} />
            <Kpi label="Categories" value={r.data.categories.length} sub={`data @ ${r.data.sha.slice(0, 7)}`} />
          </div>
        )}
      </CardBody>
    </Card>
  )
}
