import { ActionForm, Field } from '@/app/(app)/inventory/forms'
import { handOverAction, lineFulfilmentAction } from '@/app/(app)/sales/actions'
import { moveDeliveryAction } from '@/app/(app)/deliveries/actions'
import { input } from '@/app/(app)/website/forms'
import type { SaleLine } from '@/lib/sales/model'
import { SALE_COPY, type Lang } from './copy'

/**
 * The handover buttons for one thing still to hand over, wherever it is shown
 * (the sale page, the shop's deliveries tab): one primary press, and the two
 * changes a person actually makes — arrange a delivery for a pickup, or move
 * a delivery's date / turn it into a pickup. Every press goes through the
 * same server actions as the console, so a change here is a change there.
 */
export function HandoverControls({ line, delivery, lang, strong }: { line: SaleLine | null; delivery: { id: string; status: string } | null; lang: Lang; strong?: boolean }) {
  const t = SALE_COPY[lang]
  const big = 'flex flex-col gap-2 [&_button]:h-12 [&_button]:w-full [&_button]:text-base'
  const tone = strong ? 'strong' : 'primary'

  // A delivery planned on Deliveries (a website order, or a sold item): only "delivered" here; the rest is on Deliveries.
  if (!line) {
    if (!delivery) return null
    return <ActionForm action={moveDeliveryAction} hidden={{ id: delivery.id, to: 'done' }} label={t.delivered} busy={t.saving} tone={tone} confirm={t.deliveredConfirm} className={big} />
  }

  const out = delivery?.status === 'out'
  const where = (defaults: { address?: string | null; date?: string | null; window?: string | null }) => (
    <>
      <Field label={t.address}><input name="address" required dir="auto" maxLength={300} defaultValue={defaults.address ?? ''} className={input} /></Field>
      <Field label={t.date}><input name="date" type="date" defaultValue={defaults.date ?? ''} className={input} /></Field>
      <Field label={t.window}><input name="window" dir="auto" maxLength={60} defaultValue={defaults.window ?? ''} className={input} /></Field>
    </>
  )
  return (
    <div className="flex flex-col gap-1">
      <ActionForm action={handOverAction} hidden={{ lineId: line.id }} label={line.fulfilment === 'delivery' ? t.delivered : t.pickedUp} busy={t.saving} tone={tone} confirm={t.handOverConfirm} className={big} />
      {/* A delivery already on its way is closed on Deliveries first (setLineFulfilment refuses it). */}
      {out ? null : line.fulfilment === 'pickup' ? (
        <details className="text-sm">
          <summary className="cursor-pointer py-2 text-muted">{t.arrangeDelivery}</summary>
          <ActionForm action={lineFulfilmentAction} hidden={{ lineId: line.id, to: 'delivery' }} label={t.saveChange} busy={t.saving} className="mt-1 grid gap-2 sm:grid-cols-3">
            {where({})}
          </ActionForm>
        </details>
      ) : (
        <div className="flex flex-col gap-1">
          <details className="text-sm">
            <summary className="cursor-pointer py-2 text-muted">{t.reschedule}</summary>
            <ActionForm action={lineFulfilmentAction} hidden={{ lineId: line.id, to: 'delivery' }} label={t.saveChange} busy={t.saving} className="mt-1 grid gap-2 sm:grid-cols-3">
              {where({ address: line.address, date: line.scheduledFor, window: line.timeWindow })}
            </ActionForm>
          </details>
          <ActionForm action={lineFulfilmentAction} hidden={{ lineId: line.id, to: 'pickup' }} label={t.toPickup} busy={t.saving} confirm={t.toPickupConfirm} className="flex flex-col gap-1 [&_button]:w-full" />
        </div>
      )}
    </div>
  )
}
