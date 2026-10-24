import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { audit } from '@/lib/audit/audit'
import { volunteerStats } from '@/lib/volunteers/analytics'
import { dailyCsv, peopleCsv, projectsCsv, summaryCsv } from '@/lib/volunteers/csv'
import { personRecords } from '@/lib/volunteers/admin'
import { addDays, israelToUtc } from '@/lib/volunteers/time'
import { loadWindow } from '../load'
import { reportRange } from '../range'

export const dynamic = 'force-dynamic'

/**
 * GET /volunteers/export?kind=summary|daily|projects|people&from=&to=[&project=]
 * The report page as CSV. `people` (names, emails, hours) needs
 * volunteers:read_pii. Every export is audited: it is data leaving the console.
 */
export async function GET(request: Request) {
  const s = await getSession()
  if (!s) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  if (!may('volunteers:read')) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  const sp = Object.fromEntries(new URL(request.url).searchParams)
  const kind = sp.kind
  if (!['summary', 'daily', 'projects', 'people'].includes(kind ?? '')) return NextResponse.json({ error: 'kind must be summary, daily, projects or people' }, { status: 400 })
  if (kind === 'people' && !may('volunteers:read_pii')) return NextResponse.json({ error: 'needs volunteers:read_pii' }, { status: 403 })
  const { range, error } = reportRange(sp)
  if (error) return NextResponse.json({ error }, { status: 400 })
  const now = Date.now()
  const data = await loadWindow('2000-01-01T00:00:00Z', israelToUtc(addDays(range.to, 2), '00:00')!, now)
  const filter = sp.project ? { projectId: sp.project === 'none' ? null : sp.project } : {}
  const st = volunteerStats(data, range, now, filter)
  let body: string
  if (kind === 'people') {
    const from = israelToUtc(range.from, '00:00')!
    const to = israelToUtc(addDays(range.to, 1), '00:00')!
    const inRange = new Set(data.shifts.filter((x) => x.startsAt >= from && x.startsAt < to && (!sp.project || data.activities.find((a) => a.id === x.activityId)?.furnitureProjectId === (sp.project === 'none' ? null : sp.project))).map((x) => x.id))
    const rec = personRecords(data.signups.filter((x) => inRange.has(x.shiftId)), data.shifts, now)
    body = peopleCsv(data.volunteers.filter((v) => v.status !== 'deleted' && rec.has(v.id)).map((v) => ({ name: v.fullName, email: v.email, record: rec.get(v.id)! })).sort((a, b) => b.record.minutes - a.record.minutes))
  } else body = kind === 'daily' ? dailyCsv(st) : kind === 'projects' ? projectsCsv(st) : summaryCsv(st)
  await audit(s.user, { action: 'volunteers.export', product: 'volunteers', target: kind!, outcome: 'succeeded', detail: { range, project: sp.project ?? null } })
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="jas-volunteers-${kind}-${range.from}_${range.to}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
