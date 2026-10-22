import { Download } from 'lucide-react'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { AnalyticsSection } from '@/components/analytics/section'
import { requireUser, userCan } from '@/lib/auth/session'
import { METRICS } from '@/lib/metrics-catalog'
import { loadAnalytics } from '@/lib/analytics/load'
import { analyticsRange } from '@/lib/analytics/range'
import { timeAgo } from '@/lib/format'
import { PRODUCTS, type Product } from '@/lib/auth/rbac'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>

export default async function AnalyticsPage({ searchParams }: { searchParams?: SP }) {
  await requireUser()
  const allowed = new Set<Product>((await Promise.all(PRODUCTS.map(async (p) => ((await userCan(`${p}:read`)) ? p : null)))).filter((p): p is Product => p !== null))
  const { range, label, custom, error } = analyticsRange(searchParams)
  const report = await loadAnalytics(range, (p) => allowed.has(p))
  const previousLabel = `${report.previous.from} – ${report.previous.to}`
  const qs = new URLSearchParams(custom ? { from: range.from, to: range.to } : typeof searchParams?.range === 'string' ? { range: searchParams.range } : {})
  const exportHref = (kind: string) => `/analytics/export?${new URLSearchParams({ ...Object.fromEntries(qs), kind })}`
  const readAt = new Map(report.sections.flatMap((s) => s.metrics.map((m) => [m.id, s.sources.find((x) => x.key === m.source)] as const)))

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Each system on its own terms, for the selected period against the one right before it. Systems are never added together: website revenue, gift card face value, furniture progress and the design agent count different things about different people."
        actions={
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['metrics', 'Metrics CSV'],
                ['daily', 'Daily CSV'],
                ['tables', 'Breakdowns CSV'],
              ] as const
            ).map(([k, l]) => (
              <a key={k} href={exportHref(k)} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-sm hover:bg-sunken">
                <Download aria-hidden className="h-3.5 w-3.5" strokeWidth={1.75} />
                {l}
              </a>
            ))}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3">
        <div className="text-sm">
          <div className="font-medium text-ink">{label}</div>
          <div className="num text-xs text-muted">
            {range.from} – {range.to} compared with {previousLabel}
          </div>
          {error ? <p role="alert" className="mt-1 text-xs text-bad">Custom range ignored: {error}</p> : null}
        </div>
        <form method="get" className="flex flex-wrap items-end gap-2 text-xs">
          <label className="flex flex-col gap-0.5 text-muted">
            From
            <input type="date" name="from" defaultValue={range.from} required className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" />
          </label>
          <label className="flex flex-col gap-0.5 text-muted">
            To
            <input type="date" name="to" defaultValue={range.to} required className="h-9 rounded-md border border-line bg-surface px-2 text-sm text-ink" />
          </label>
          <button type="submit" className="h-9 rounded-md border border-line px-3 text-sm text-ink hover:bg-sunken">Apply</button>
          {custom ? <a href="/analytics" className="h-9 px-1 text-sm leading-9 text-muted underline-offset-2 hover:underline">Reset</a> : null}
        </form>
      </div>

      {report.sections.length ? (
        <>
          <nav aria-label="Sections" className="mb-4 flex flex-wrap gap-2 text-sm">
            {report.sections.map((s) => (
              <a key={s.product} href={`#${s.product}`} className="rounded-full border border-line px-3 py-1 text-muted hover:bg-sunken hover:text-ink">{s.title}</a>
            ))}
            <a href="#catalogue" className="rounded-full border border-line px-3 py-1 text-muted hover:bg-sunken hover:text-ink">Metrics catalogue</a>
          </nav>
          <div className="flex flex-col gap-5">
            {report.sections.map((s) => <AnalyticsSection key={s.product} section={s} previousLabel={previousLabel} />)}
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Your role cannot read any of the systems analytics covers.</p>
      )}

      <Card className="mt-6">
        <span id="catalogue" className="block scroll-mt-20" />
        <CardHeader title="Metrics catalogue" meta={`${METRICS.length} metrics · one formula, one source each`} />
        <CardBody className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 text-start font-medium">Metric</th>
                <th className="text-start font-medium">Basis</th>
                <th className="text-start font-medium">Formula</th>
                <th className="text-start font-medium">Source</th>
                <th className="text-start font-medium">Refresh</th>
                <th className="text-start font-medium">Last read</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => {
                const src = readAt.get(m.id)
                return (
                  <tr key={m.id} className="border-t border-line/50 align-top">
                    <td className="py-2 pe-3">
                      <div className="font-medium">{m.label}</div>
                      <div className="font-mono text-meta text-faint">{m.id}</div>
                    </td>
                    <td className="py-2 pe-3 text-xs text-muted">{m.basis === 'period' ? 'Period' : 'Now'}</td>
                    <td className="py-2 pe-3 text-muted">{m.formula}</td>
                    <td className="py-2 pe-3 text-xs">{m.source}</td>
                    <td className="py-2 pe-3 text-xs text-muted">{m.refresh}</td>
                    <td className="py-2 text-xs text-muted">
                      {!src ? 'not on this page' : src.state === 'ok' ? timeAgo(src.checkedAt) : src.state === 'error' ? <span className="text-bad">failed</span> : 'not connected'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  )
}
