import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { CapabilityList } from '@/components/capabilities'
import { getMapData, mapAdapter } from '@/lib/integrations/map/adapter'
import { requirePageAccess } from '@/lib/auth/session'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default async function MapPage() {
  await requirePageAccess('map:read')
  const r = await getMapData()
  const site = env().map.siteUrl
  return (
    <>
      <PageHeader
        title="Interactive map"
        description="The JAS neighbourhood route: partner places around the store, published from places-data.js by GitHub Pages. It does not show furniture projects — the two share no identifiers."
        actions={<a href={site} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-sunken">Open map</a>}
      />
      {r.state !== 'ok' ? (
        <SourceProblem result={r} what="Map places" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
          <Card>
            <CardHeader title={`${r.data.places.length} places`} meta={<><Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} /> · commit {r.data.sha.slice(0, 7)}</>} />
            <CardBody className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-xs text-muted"><tr><th className="py-1 text-start font-medium">#</th><th className="text-start font-medium">Place</th><th className="text-start font-medium">Category</th><th className="text-start font-medium">Hours</th><th className="text-end font-medium">Coordinates</th></tr></thead>
                <tbody>
                  {r.data.places.map((p) => (
                    <tr key={p.id} className="border-t border-line/50 align-top">
                      <td className="num py-2 text-muted">{p.id}</td>
                      <td className="py-2"><div className="font-medium" dir="auto">{p.name}</div>{p.sub ? <div className="text-xs text-muted" dir="auto">{p.sub}</div> : null}</td>
                      <td className="py-2" dir="auto">{r.data.categories.find((c) => c.key === p.cat)?.label ?? p.cat}</td>
                      <td className="max-w-[220px] py-2 text-xs text-muted" dir="auto">{p.hours ?? '—'}</td>
                      <td className="num py-2 text-end font-mono text-xs"><a className="underline-offset-2 hover:underline" href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`} target="_blank" rel="noreferrer">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</a></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Categories" />
            <CardBody>
              <ul className="flex flex-col gap-1.5 text-sm">
                {r.data.categories.map((c) => (
                  <li key={c.key} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2" dir="auto"><span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />{c.label}</span>
                    <span className="num text-muted">{r.data.places.filter((p) => p.cat === c.key).length}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}
      <Card className="mt-6">
        <CardHeader title="What this integration can do" />
        <CardBody>
          <CapabilityList items={mapAdapter.capabilities()} />
        </CardBody>
      </Card>
    </>
  )
}
