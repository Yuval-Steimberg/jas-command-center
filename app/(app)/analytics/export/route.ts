import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { canReadAnalytics } from '@/lib/auth/rbac'
import { audit } from '@/lib/audit/audit'
import { loadAnalytics } from '@/lib/analytics/load'
import { analyticsRange } from '@/lib/analytics/range'
import { dailyCsv, metricsCsv, tablesCsv } from '@/lib/analytics/csv'

export const dynamic = 'force-dynamic'

const KINDS = { metrics: metricsCsv, daily: dailyCsv, tables: tablesCsv } as const

/**
 * GET /analytics/export?kind=metrics|daily|tables&range=|from=&to= — the
 * analytics report as CSV. Same permission filter as the page (a product the
 * user cannot read is never fetched), and every export is audited: it is data
 * leaving the console.
 */
export async function GET(request: Request) {
  const s = await getSession()
  if (!s) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const sp = Object.fromEntries(new URL(request.url).searchParams)
  const kind = sp.kind as keyof typeof KINDS
  if (!Object.hasOwn(KINDS, kind)) return NextResponse.json({ error: 'kind must be metrics, daily or tables' }, { status: 400 })
  const { range, error } = analyticsRange(sp)
  if (error) return NextResponse.json({ error }, { status: 400 })
  const report = await loadAnalytics(range, (p) => canReadAnalytics(s.user.role, p, s.overrides))
  await audit(s.user, { action: 'analytics.export', product: null, target: kind, outcome: 'succeeded', detail: { range, products: report.sections.map((x) => x.product) } })
  return new NextResponse(KINDS[kind](report), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="jas-analytics-${kind}-${range.from}_${range.to}.csv"`,
      'Cache-Control': 'no-store',
    },
  })
}
