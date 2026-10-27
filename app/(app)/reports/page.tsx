import Link from 'next/link'
import { Download } from 'lucide-react'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/status'
import { AlertsList } from '@/components/alerts-list'
import { getSession, requireUser } from '@/lib/auth/session'
import { canReadAnalytics } from '@/lib/auth/rbac'
import { timeAgo } from '@/lib/format'
import { isReportKind, REPORT_KINDS, type ReportKind, type ReportLine } from '@/lib/reports/business'
import { loadBusinessReport } from '@/lib/reports/load'

export const dynamic = 'force-dynamic'

function Lines({ lines, empty }: { lines: ReportLine[]; empty: string }) {
  if (!lines.length) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {lines.map((l) => (
        <li key={`${l.section}:${l.label}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
          <span><span className="text-muted">{l.section} · </span>{l.label}</span>
          <span className="num">{l.value}{l.change ? <span className="ms-2 text-xs text-muted">{l.change}</span> : null}</span>
        </li>
      ))}
    </ul>
  )
}

export default async function ReportsPage({ searchParams }: { searchParams?: { kind?: string } }) {
  await requireUser()
  const s = (await getSession())!
  const kind: ReportKind = isReportKind(searchParams?.kind) ? searchParams.kind : 'weekly'
  const r = await loadBusinessReport(kind, (p) => canReadAnalytics(s.user.role, p, s.overrides))
  return (
    <>
      <PageHeader
        title="Reports"
        description="A business summary built from the same live reads as Analytics and Notifications. Each period is compared with the one right before it; anything that could not be read is listed, never counted as zero."
        actions={
          <a href={`/reports/export?kind=${kind}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm hover:bg-sunken">
            <Download aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
            Download (Markdown)
          </a>
        }
      />
      <nav className="mb-4 flex flex-wrap gap-2" aria-label="Report period">
        {(Object.keys(REPORT_KINDS) as ReportKind[]).map((k) => (
          <Link key={k} href={`/reports?kind=${k}`} aria-current={k === kind ? 'page' : undefined} className={k === kind ? 'rounded-full bg-forest px-3 py-2 text-sm font-medium text-cream' : 'rounded-full border border-line px-3 py-2 text-sm hover:bg-sunken'}>
            {REPORT_KINDS[k].label}
          </Link>
        ))}
      </nav>
      <p className="mb-4 text-sm text-muted">
        <span className="num">{r.period}</span> compared with <span className="num">{r.previous}</span> · generated {timeAgo(r.generatedAt)}
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Improved" meta="Up at least 10% (2 pp for rates), complete data only" />
          <CardBody><Lines lines={r.improved} empty="Nothing moved that much in the right direction." /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Declined" meta="Down at least 10% (2 pp for rates), complete data only" />
          <CardBody><Lines lines={r.declined} empty="Nothing moved that much in the wrong direction." /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Problems" meta={`${r.problems.length} open`} />
          <CardBody><AlertsList alerts={r.problems} /></CardBody>
        </Card>
        <Card>
          <CardHeader title="Recommended next actions" meta="From open problems and unreadable sources" />
          <CardBody>
            {!r.actions.length ? <p className="text-sm text-muted">Nothing needs action.</p> : (
              <ul className="flex flex-col gap-2 text-sm">
                {r.actions.map((a) => (
                  <li key={a.title}>
                    <Link href={a.href} className="font-medium underline-offset-2 hover:underline" dir="auto">{a.title}</Link>
                    <div className="text-xs text-muted" dir="auto">{a.detail}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {r.health.length ? (
        <Card className="mt-4">
          <CardHeader title="System health" />
          <CardBody>
            <ul className="divide-y divide-line/70">
              {r.health.map((h) => (
                <li key={h.name} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div className="min-w-0"><div>{h.name}</div>{h.detail ? <div className="text-xs text-muted" dir="auto">{h.detail}</div> : null}</div>
                  <StatusBadge status={h.status} />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        {r.sections.map((sec) => (
          <Card key={sec.title}>
            <CardHeader title={sec.title} />
            <CardBody>
              {!sec.lines.length ? <p className="text-sm text-muted">No data could be read for this period.</p> : (
                <table className="w-full text-sm">
                  <tbody>
                    {sec.lines.map((l) => (
                      <tr key={l.label} className="border-t border-line/50 first:border-0">
                        <td className="py-1.5">{l.label}{l.qualifier ? <span className="ms-1 text-xs text-muted">({l.qualifier})</span> : null}</td>
                        <td className="num py-1.5 text-end">{l.value}</td>
                        <td className="num w-20 py-1.5 text-end text-xs text-muted">{l.change ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {sec.notes.map((n) => <p key={n} className="mt-2 text-xs text-muted">{n}</p>)}
            </CardBody>
          </Card>
        ))}
      </div>

      {r.gaps.length ? (
        <Card className="mt-4">
          <CardHeader title="Not included" meta="Sources that could not be read" />
          <CardBody>
            <ul className="flex flex-col gap-1 text-sm">{r.gaps.map((g) => <li key={`${g.section}:${g.source}`}><span className="font-medium">{g.section}, {g.source}:</span> <span className="text-muted">{g.detail}</span></li>)}</ul>
          </CardBody>
        </Card>
      ) : null}
      <p className="mt-4 text-xs text-muted">Scheduled email delivery is not set up: the command center has no email provider of its own yet.</p>
    </>
  )
}
