import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Freshness, SourceProblem } from '@/components/ui/source-state'
import type { SourceResult } from '@/lib/integrations/types'
import type { FurnitureKpis } from '@/lib/integrations/furniture/field'

// Display only. Every figure is the field app's `projectKpis` output; this
// file formats it and never adds, rounds into, or combines two of them.
const kg = (n: number, estimatedShare: number) => `${estimatedShare > 0 ? '≈' : ''}${n.toLocaleString('en-GB', { maximumFractionDigits: n < 100 ? 1 : 0 })} kg`
const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`)

function Stat({ label, value, note }: { label: string; value: string; note?: string | null }) {
  return (
    <div className="min-w-[10rem]">
      <div className="text-xs text-muted">{label}</div>
      <div className="num text-lg font-semibold">{value}</div>
      {note ? <div className="text-xs text-muted">{note}</div> : null}
    </div>
  )
}

export function KpiCard({ result }: { result: SourceResult<FurnitureKpis> }) {
  return (
    <Card className="mb-4">
      <CardHeader
        title="Impact (from the field app)"
        meta={result.state === 'ok' ? <Freshness checkedAt={result.checkedAt} source={result.source} latencyMs={result.latencyMs} /> : undefined}
      />
      <CardBody>
        {result.state !== 'ok' ? (
          <SourceProblem result={result} what="Furniture impact figures" />
        ) : (
          <Body k={result.data} />
        )}
      </CardBody>
    </Card>
  )
}

function Body({ k }: { k: FurnitureKpis }) {
  const { documented, planned, confirmed, confirmedCarbon, plannedCarbon } = k.kpis
  if (!k.itemCount) return <p className="text-sm text-muted">No items documented yet, so there is nothing to report.</p>
  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap gap-x-8 gap-y-3">
        <Stat label="Documented" value={kg(documented.kg, documented.estimatedShare)} note={`${documented.units} units`} />
        <Stat label="Diverted, confirmed" value={kg(confirmed.total.kg, confirmed.total.estimatedShare)} note={`${pct(k.diversionRate.confirmed)} of documented${confirmed.incomplete.length ? ' · lower bound' : ''}`} />
        <Stat label="Diverted, planned" value={kg(planned.total.kg, planned.total.estimatedShare)} note={`${pct(k.diversionRate.planned)} of documented`} />
        <Stat label="CO₂e avoided, confirmed" value={kg(confirmedCarbon.co2e_kg, confirmedCarbon.estimatedShare)} />
        <Stat label="CO₂e avoided, planned" value={kg(plannedCarbon.co2e_kg, plannedCarbon.estimatedShare)} />
      </div>
      <p className="text-xs text-muted">
        Confirmed = collected by our crew or handed over to a recycler. Planned = destination assigned during mapping. They are two views of the same items and are never added.
        {' '}A report leads with <strong>{k.headline.basis}</strong>{k.headline.isPartial ? ' (a lower bound)' : ''}. ≈ marks figures that rest partly on estimated weights.
        {' '}There is no landfill figure: material left as תיעוד is not measured disposal.
      </p>
      {!k.handoverAvailable ? <p className="text-xs text-bad">The field app&apos;s database cannot record handovers yet, so confirmed recycling is excluded.</p> : null}
      {k.missingColumns.length ? <p className="text-xs text-muted">Columns missing in the field database: {k.missingColumns.join(', ')}.</p> : null}
    </div>
  )
}
