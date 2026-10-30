import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import { CapabilityList } from '@/components/capabilities'
import { Progress } from '@/components/progress'
import { furnitureAdapter, getFurnitureProjects } from '@/lib/integrations/furniture/adapter'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { env } from '@/lib/env'
import { cn } from '@/lib/cn'

export const dynamic = 'force-dynamic'

export default async function FurniturePage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  await requirePageAccess('furniture:read')
  const showArchived = searchParams?.archived === '1'
  const r = await getFurnitureProjects()
  const appUrl = env().furniture.appUrl
  const s = (await getSession())!
  const write = can(s.user.role, 'furniture:write', s.overrides)
  return (
    <>
      <PageHeader
        title="Furniture collection"
        description="Projects and progress from the field app's database, using the app's own summary view. Weight, diversion and CO₂ are computed by the field app, and every change made here is made by the field app itself."
        actions={
          <div className="flex flex-wrap gap-2">
            {write ? <Link href="/furniture/new" className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-sunken">New project</Link> : null}
            {appUrl ? <a href={appUrl} target="_blank" rel="noreferrer" className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-sunken">Open field app</a> : null}
          </div>
        }
      />
      {r.state !== 'ok' ? (
        <SourceProblem result={r} what="Furniture projects" />
      ) : (
        <Card>
          <CardHeader
            title={`${showArchived ? 'All' : 'Active'} projects`}
            meta={<Freshness checkedAt={r.checkedAt} source={r.source} latencyMs={r.latencyMs} />}
            action={
              <Link href={showArchived ? '/furniture' : '/furniture?archived=1'} className="text-xs text-muted underline-offset-2 hover:underline">
                {showArchived ? 'Hide archived' : 'Show archived'}
              </Link>
            }
          />
          <CardBody>
            {(() => {
              const rows = r.data.filter((p) => showArchived || !p.archived)
              if (!rows.length) return <p className="text-sm text-muted">No {showArchived ? '' : 'active '}projects.</p>
              return (
                <ul className="divide-y divide-line/70">
                  {rows.map((p) => (
                    <li key={p.id} className="grid gap-3 py-3 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center">
                      <div className="min-w-0">
                        <Link href={`/furniture/${p.id}`} className={cn('block truncate text-sm font-medium underline-offset-2 hover:underline', p.archived && 'text-muted')} dir="auto">{p.name}</Link>
                        <div className="truncate text-xs text-muted">
                          {[p.city, p.developer_name].filter(Boolean).map((t, i) => (
                            <span key={i}>{i ? ' · ' : ''}<bdi>{t}</bdi></span>
                          ))}
                          {p.start_date ? ` · from ${p.start_date}` : ''}
                          {p.archived ? ' · archived' : ''}
                        </div>
                      </div>
                      <Progress label="Apartments completed" value={p.apartmentsCompleted} total={p.apartments} />
                      <Progress label="Items collected" value={p.itemsCollected} total={p.itemsToCollect} />
                      <div className="num text-xs text-muted md:text-end">{p.items} items recorded</div>
                    </li>
                  ))}
                </ul>
              )
            })()}
          </CardBody>
        </Card>
      )}
      <Card className="mt-6">
        <CardHeader title="What this integration can do" />
        <CardBody>
          <CapabilityList items={furnitureAdapter.capabilities()} />
        </CardBody>
      </Card>
    </>
  )
}
