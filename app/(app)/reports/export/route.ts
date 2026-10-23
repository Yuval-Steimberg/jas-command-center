import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { audit } from '@/lib/audit/audit'
import { isReportKind, reportMarkdown } from '@/lib/reports/business'
import { loadBusinessReport } from '@/lib/reports/load'

export const dynamic = 'force-dynamic'

/** GET /reports/export?kind=daily|weekly|monthly — the report as Markdown. Audited: it is data leaving the console. */
export async function GET(request: Request) {
  const s = await getSession()
  if (!s) return NextResponse.json({ error: 'not signed in' }, { status: 401 })
  const url = new URL(request.url)
  const kind = url.searchParams.get('kind')
  if (!isReportKind(kind)) return NextResponse.json({ error: 'kind must be daily, weekly or monthly' }, { status: 400 })
  const report = await loadBusinessReport(kind, (p) => can(s.user.role, `${p}:read`, s.overrides))
  await audit(s.user, { action: 'report.export', product: null, target: kind, outcome: 'succeeded', detail: { period: report.period, sections: report.sections.map((x) => x.title) } })
  return new NextResponse(reportMarkdown(report, url.origin), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="jas-${kind}-report-${report.period.replace(/ – /, '_')}.md"`,
      'Cache-Control': 'no-store',
    },
  })
}
