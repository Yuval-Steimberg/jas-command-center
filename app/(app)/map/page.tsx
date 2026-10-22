import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { CapabilityList } from '@/components/capabilities'
import { getMapData, mapAdapter } from '@/lib/integrations/map/adapter'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import Link from 'next/link'
import { listPlacePullRequests, type MapPullRequest } from '@/lib/integrations/map/github'
import { formatDateTime } from '@/lib/format'
import { PlaceForm, RemovePlaceForm } from './forms'
import { getMapTraffic } from '@/lib/integrations/map/ga4'
import { env } from '@/lib/env'

export const dynamic = 'force-dynamic'

export default async function MapPage({ searchParams }: { searchParams: { edit?: string } }) {
  await requirePageAccess('map:read')
  const s = (await getSession())!
  const write = can(s.user.role, 'map:write', s.overrides)
  const [r, traffic] = await Promise.all([getMapData(), getMapTraffic()])
  const site = env().map.siteUrl
  const tokenSet = Boolean(env().map.githubToken)
  let pending: MapPullRequest[] | string = []
  if (write && tokenSet) pending = await listPlacePullRequests().catch((e: unknown) => (e instanceof Error ? e.message : String(e)))
  const editId = searchParams.edit === 'new' ? 'new' : Number(searchParams.edit)
  const editing = r.state === 'ok' && typeof editId === 'number' ? r.data.places.find((p) => p.id === editId) : undefined
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
                <thead className="text-xs text-muted"><tr><th className="py-1 text-start font-medium">#</th><th className="text-start font-medium">Place</th><th className="text-start font-medium">Category</th><th className="text-start font-medium">Hours</th><th className="text-end font-medium">Coordinates</th>{write ? <th /> : null}</tr></thead>
                <tbody>
                  {r.data.places.map((p) => (
                    <tr key={p.id} className="border-t border-line/50 align-top">
                      <td className="num py-2 text-muted">{p.id}</td>
                      <td className="py-2"><div className="font-medium" dir="auto">{p.name}</div>{p.sub ? <div className="text-xs text-muted" dir="auto">{p.sub}</div> : null}</td>
                      <td className="py-2" dir="auto">{r.data.categories.find((c) => c.key === p.cat)?.label ?? p.cat}</td>
                      <td className="max-w-[220px] py-2 text-xs text-muted" dir="auto">{p.hours ?? '—'}</td>
                      <td className="num py-2 text-end font-mono text-xs"><a className="underline-offset-2 hover:underline" href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=18/${p.lat}/${p.lng}`} target="_blank" rel="noreferrer">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</a></td>
                      {write ? <td className="py-2 text-end"><Link href={`/map?edit=${p.id}#edit`} className="inline-flex h-8 items-center rounded-full border border-line px-3 text-xs font-medium hover:bg-sunken">{p.cat === 'anchor' ? 'Edit' : 'Edit / remove'}</Link></td> : null}
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
        <CardHeader title="Map visitors" meta={traffic.state === 'ok' ? <Freshness checkedAt={traffic.checkedAt} source={traffic.source} latencyMs={traffic.latencyMs} /> : 'Google Analytics 4'} />
        <CardBody>
          {traffic.state !== 'ok' ? (
            <SourceProblem result={traffic} what="Map visitors" />
          ) : !traffic.data.hasData ? (
            <p className="text-sm text-muted">GA4 returned no data for the last {traffic.data.days} days. The tag on the map may not be sending, or the property id is a different property.</p>
          ) : (
            <div className="flex flex-col gap-3 text-sm">
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                {([['activeUsers', 'Visitors'], ['sessions', 'Sessions'], ['screenPageViews', 'Page views']] as const).map(([k, label]) => {
                  const cur = traffic.data.current[k]
                  const prev = traffic.data.previous[k]
                  return (
                    <div key={k}>
                      <div className="text-xs text-muted">{label}, last {traffic.data.days} days</div>
                      <div className="num text-xl font-semibold">{cur.toLocaleString('en-IL')}</div>
                      <div className="text-meta text-muted">{prev ? `${cur >= prev ? '+' : ''}${Math.round(((cur - prev) / prev) * 100)}% vs the ${traffic.data.days} days before (${prev.toLocaleString('en-IL')})` : 'no data for the period before'}</div>
                    </div>
                  )
                })}
              </div>
              {traffic.data.sources.length ? (
                <div>
                  <div className="text-xs font-semibold text-muted">Where sessions came from</div>
                  <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">{traffic.data.sources.map((x) => <li key={x.source}><span dir="ltr">{x.source}</span> <span className="num text-muted">{x.sessions}</span></li>)}</ul>
                </div>
              ) : null}
            </div>
          )}
        </CardBody>
      </Card>
      {write && r.state === 'ok' ? (
        <div id="edit" className="mt-6">
        <Card>
          <CardHeader
            title={editing ? `Edit #${editing.id} ${editing.name}` : 'Propose a change'}
            meta={editing || editId === 'new' ? <Link href="/map" className="underline-offset-2 hover:underline">Close</Link> : 'Every change is a pull request you merge on GitHub'}
          />
          <CardBody>
            {!tokenSet ? (
              <p className="text-sm text-muted">Set GITHUB_TOKEN on this deployment (fine-grained, the map repository only, Contents and Pull requests: read and write) to propose changes from here.</p>
            ) : editing ? (
              <div className="flex flex-col gap-4">
                <PlaceForm key={editing.id} place={editing} categories={r.data.categories} />
                {editing.cat !== 'anchor' ? <RemovePlaceForm key={`rm-${editing.id}`} place={editing} /> : null}
              </div>
            ) : editId === 'new' ? (
              <PlaceForm categories={r.data.categories} />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/map?edit=new#edit" className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken">Add a place</Link>
                <span className="text-sm text-muted">To change or remove a place, use “Edit / remove” on its row above.</span>
              </div>
            )}
            {typeof pending === 'string' ? (
              <p className="mt-3 text-sm text-bad">Could not list open changes: {pending}</p>
            ) : pending.length ? (
              <div className="mt-4">
                <p className="text-xs font-semibold text-muted">Waiting for review on GitHub</p>
                <ul className="mt-1 divide-y divide-line/70 text-sm">
                  {pending.map((p) => (
                    <li key={p.number} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <a href={p.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline" dir="auto">#{p.number} {p.title}</a>
                      <span className="text-meta text-muted">{formatDateTime(p.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
        </div>
      ) : null}
      <Card className="mt-6">
        <CardHeader title="What this integration can do" />
        <CardBody>
          <CapabilityList items={mapAdapter.capabilities()} />
        </CardBody>
      </Card>
    </>
  )
}
