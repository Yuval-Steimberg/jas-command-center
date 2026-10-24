import Link from 'next/link'
import { PageHeader } from '@/components/ui/card'
import { OpsUnavailable, linkCls } from '@/components/ops/ui'
import { requirePageAccess } from '@/lib/auth/session'
import { loadOps } from '@/lib/ops/guard'
import { cn } from '@/lib/cn'
import { addDays, israelDay, israelTime, israelToUtc, israelWeekday } from '@/lib/volunteers/time'
import { DAYS, DAY_EN } from '@/lib/volunteers/model'
import type { ShiftView } from '@/lib/volunteers/views'
import { loadWindow } from '../load'
import { VolNav } from '../ui'

export const dynamic = 'force-dynamic'

const valid = (d: string | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && israelToUtc(d, '12:00') ? d : null)
const monthName = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })

export default async function CalendarPage({ searchParams }: { searchParams: { view?: string; date?: string; project?: string } }) {
  await requirePageAccess('volunteers:read')
  const now = Date.now()
  const view = searchParams.view === 'month' ? 'month' : searchParams.view === 'day' ? 'day' : 'week'
  const anchor = valid(searchParams.date) ?? israelDay(now)
  // Weeks start on Sunday, as they do in Israel.
  const weekStart = addDays(anchor, -DAYS.indexOf(israelWeekday(israelToUtc(anchor, '12:00')!)))
  const monthStart = `${anchor.slice(0, 7)}-01`
  const gridStart = addDays(monthStart, -DAYS.indexOf(israelWeekday(israelToUtc(monthStart, '12:00')!)))
  const [from, days] = view === 'day' ? [anchor, 1] : view === 'week' ? [weekStart, 7] : [gridStart, 42]
  const to = addDays(from, days)
  const res = await loadOps(() => loadWindow(israelToUtc(from, '00:00')!, israelToUtc(to, '00:00')!, now))
  const project = searchParams.project ?? ''
  const step = view === 'day' ? 1 : view === 'week' ? 7 : 0
  const prev = view === 'month' ? addDays(monthStart, -1).slice(0, 7) + '-01' : addDays(anchor, -step)
  const next = view === 'month' ? addDays(addDays(monthStart, 31), 0).slice(0, 7) + '-01' : addDays(anchor, step)
  const q = (o: Record<string, string>) => `/volunteers/calendar?${new URLSearchParams({ view, date: anchor, ...(project ? { project } : {}), ...o })}`

  return (
    <>
      <PageHeader title="Calendar" description="Every shift, including drafts (marked) and cancelled ones (struck through). Times are Israel time." />
      <VolNav active="/volunteers/calendar" />
      {!res.ok ? <OpsUnavailable title="Volunteers are not available" message={res.message} /> : (() => {
        const projects = [...new Map(res.data.activities.filter((a) => a.furnitureProjectId).map((a) => [a.furnitureProjectId!, a.furnitureProjectName ?? 'Project'])).entries()]
        const views = res.data.views.filter((v) => !project || (project === 'none' ? !v.activity.furnitureProjectId : v.activity.furnitureProjectId === project))
        const byDay = new Map<string, ShiftView[]>()
        for (const v of views) byDay.set(israelDay(v.shift.startsAt), [...(byDay.get(israelDay(v.shift.startsAt)) ?? []), v])
        const today = israelDay(now)
        return (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <Link href={q({ date: prev })} className="h-9 rounded-full border border-line px-3 leading-9 hover:bg-sunken" aria-label="Previous">←</Link>
              <Link href={q({ date: today })} className="h-9 rounded-full border border-line px-3 leading-9 hover:bg-sunken">Today</Link>
              <Link href={q({ date: next })} className="h-9 rounded-full border border-line px-3 leading-9 hover:bg-sunken" aria-label="Next">→</Link>
              <span className="font-medium">{view === 'month' ? monthName.format(new Date(`${monthStart}T12:00:00Z`)) : view === 'week' ? `${weekStart} – ${addDays(weekStart, 6)}` : anchor}</span>
              <span className="ms-auto flex gap-1">
                {(['day', 'week', 'month'] as const).map((x) => <Link key={x} href={q({ view: x })} className={cn('h-9 rounded-full px-3 leading-9', view === x ? 'bg-sunken font-medium' : 'text-muted hover:text-ink')}>{x[0]!.toUpperCase() + x.slice(1)}</Link>)}
              </span>
              <form method="get" className="flex items-center gap-2">
                <input type="hidden" name="view" value={view} /><input type="hidden" name="date" value={anchor} />
                <select name="project" defaultValue={project} className="h-9 rounded-md border border-line bg-surface px-2 text-sm">
                  <option value="">All projects</option><option value="none">No project</option>
                  {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                </select>
                <button className="h-9 rounded-full border border-line px-3 hover:bg-sunken">Filter</button>
              </form>
            </div>
            {view === 'month' ? (
              <div className="overflow-x-auto">
                <div className="grid min-w-[52rem] grid-cols-7 gap-px rounded-md border border-line bg-line">
                  {DAYS.map((d) => <div key={d} className="bg-sunken px-2 py-1 text-xs text-muted">{DAY_EN[d]}</div>)}
                  {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((d) => (
                    <div key={d} className={cn('min-h-24 bg-surface p-1.5', d.slice(0, 7) !== monthStart.slice(0, 7) && 'bg-ground/60 text-faint')}>
                      <Link href={q({ view: 'day', date: d })} className={cn('text-xs', d === today ? 'rounded-full bg-forest px-1.5 text-cream' : 'text-muted')}>{Number(d.slice(8))}</Link>
                      <ul className="mt-1 flex flex-col gap-0.5">{(byDay.get(d) ?? []).slice(0, 4).map((v) => <Entry key={v.shift.id} v={v} compact />)}</ul>
                      {(byDay.get(d)?.length ?? 0) > 4 ? <Link href={q({ view: 'day', date: d })} className={`${linkCls} text-xs text-muted`}>+{byDay.get(d)!.length - 4} more</Link> : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className={cn('grid gap-3', view === 'week' && 'lg:grid-cols-7')}>
                {Array.from({ length: days }, (_, i) => addDays(from, i)).map((d) => (
                  <section key={d} className={cn('rounded-md border border-line/70 p-2', d === today && 'border-forest/40')}>
                    <h2 className="mb-1 text-xs font-medium text-muted">{DAY_EN[israelWeekday(israelToUtc(d, '12:00')!)]} {Number(d.slice(8))}.{Number(d.slice(5, 7))}</h2>
                    <ul className="flex flex-col gap-1">{(byDay.get(d) ?? []).map((v) => <Entry key={v.shift.id} v={v} />)}</ul>
                    {!byDay.get(d)?.length ? <p className="text-xs text-faint">—</p> : null}
                  </section>
                ))}
              </div>
            )}
          </>
        )
      })()}
    </>
  )
}

function Entry({ v, compact }: { v: ShiftView; compact?: boolean }) {
  const off = v.shift.status === 'cancelled' || v.activity.status === 'cancelled'
  const short = !off && v.counts.confirmed < v.shift.minVolunteers
  return (
    <li>
      <Link href={`/volunteers/shifts/${v.shift.id}`} className={cn('block rounded px-1.5 py-1 text-xs hover:bg-sunken', off && 'line-through opacity-60', v.activity.status === 'draft' && 'border border-dashed border-line')}>
        <span className="num">{israelTime(v.shift.startsAt)}</span> <span dir="auto" className={compact ? 'line-clamp-1' : ''}>{v.activity.title}</span>
        {!compact ? <span className={cn('block num', short ? 'text-warn' : 'text-muted')}>{v.counts.confirmed}/{v.shift.capacity}{v.counts.waitlisted ? ` +${v.counts.waitlisted}` : ''}{v.activity.status === 'draft' ? ' · draft' : ''}</span> : null}
      </Link>
    </li>
  )
}
