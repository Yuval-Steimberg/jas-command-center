import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { ActionForm, Field, LocationSelect } from '@/app/(app)/inventory/forms'
import { handOverAction, lineFulfilmentAction, paymentAction, returnLineAction } from '@/app/(app)/sales/actions'
import { input } from '@/app/(app)/website/forms'
import { formatAgorot } from '@/lib/money'
import { formatDateTime } from '@/lib/format'
import { METHOD_LABEL, PAYMENT_METHODS, PAYMENT_STATE_LABEL, keptQty, lineValue, saleMoney, type SaleLine } from '@/lib/sales/model'
import type { SaleView } from '@/lib/sales/views'
import { METHOD_LABEL_HE, PAYMENT_STATE_HE, SALE_COPY, type Lang } from './copy'

const DELIVERY_HE: Record<string, string> = { planned: 'מתוכנן', out: 'בדרך', failed: 'לא הצליח', done: 'נמסר' }
const box = 'flex flex-col gap-3 rounded-lg border border-line bg-surface p-3'

/**
 * One sale: each line with its own handover (pickup now, or its delivery),
 * returns per line, and the money ledger. Shared by /sales/[id] and the shop.
 */
export function SaleDetail({ v, lang, base, may, locations }: {
  v: SaleView
  lang: Lang
  base: '/sales' | '/shop'
  may: { operate: boolean; money: boolean }
  locations: { id: string; label: string }[]
}) {
  const t = SALE_COPY[lang]
  const methodLabel = lang === 'he' ? METHOD_LABEL_HE : METHOD_LABEL
  const m = saleMoney(v.sale, v.lines, v.payments)
  const stateLabel = (lang === 'he' ? PAYMENT_STATE_HE : PAYMENT_STATE_LABEL)[m.state]
  const itemHref = (id: string) => (base === '/shop' ? `/shop/items/${id}` : `/inventory/${id}`)
  const lineState = (l: SaleLine) => (l.status === 'returned' ? t.returned : l.status === 'done' ? t.handedOver : l.fulfilment === 'delivery' ? t.deliveryOpen : t.pickupOpen)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section className={box}>
        <h2 className="text-sm font-semibold text-ink">{t.items}</h2>
        <ul className="flex flex-col gap-3">
          {v.lines.map((l) => {
            const it = v.items.get(l.itemId)
            const d = v.deliveries.get(l.id)
            const kept = keptQty(l)
            return (
              <li key={l.id} className="flex flex-col gap-2 rounded-md border border-line/70 bg-ground/40 p-2">
                <div className="flex items-start gap-3">
                  {it?.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                  ) : null}
                  <div className="min-w-0 flex-1 text-sm">
                    <Link href={itemHref(l.itemId)} className="font-medium text-ink underline-offset-2 hover:underline" dir="auto">{it ? `${it.sku} · ${it.title}` : l.itemId}</Link>
                    <p className="text-muted">
                      <span className="num" dir="ltr">{l.quantity > 1 ? `${l.quantity} × ${formatAgorot(l.unitPriceMinor)} = ` : ''}{formatAgorot(lineValue(l))}</span>
                      {l.returnedQty ? ` · ${l.returnedQty} ${t.unitsReturned}` : ''}
                    </p>
                    <p className={l.status === 'open' ? 'text-warn' : 'text-muted'}>
                      {lineState(l)}
                      {l.fulfilment === 'delivery' && l.status === 'open' ? <> · <span dir="auto">{l.address}</span> · {l.scheduledFor ? `${t.scheduled}${l.scheduledFor}${l.timeWindow ? ` ${l.timeWindow}` : ''}` : t.noDate}{d ? <> · {base === '/shop' ? <span>{DELIVERY_HE[d.status] ?? d.status}</span> : <Link href="/deliveries" className="underline-offset-2 hover:underline">{d.status}</Link>}</> : null}</> : null}
                      {l.doneAt && l.status === 'done' ? ` · ${formatDateTime(l.doneAt, lang)}` : ''}
                    </p>
                  </div>
                </div>
                {l.status === 'open' && may.operate ? (
                  <div className="flex flex-col gap-2">
                    <ActionForm action={handOverAction} hidden={{ lineId: l.id }} label={t.handOver} busy={t.saving} tone={base === '/shop' ? 'strong' : 'primary'} confirm={t.handOverConfirm} className="flex flex-col gap-2 [&_button]:h-12 [&_button]:w-full [&_button]:text-base" />
                    <details className="text-sm">
                      <summary className="cursor-pointer py-2 text-muted">{t.change}</summary>
                      <ActionForm action={lineFulfilmentAction} hidden={{ lineId: l.id }} label={t.saveChange} busy={t.saving} className="mt-2 grid gap-2 sm:grid-cols-2">
                        <Field label={t.delivery}>
                          <select name="to" defaultValue={l.fulfilment} className={input}>
                            <option value="pickup">{lang === 'he' ? 'איסוף' : 'Pickup'}</option>
                            <option value="delivery">{lang === 'he' ? 'משלוח' : 'Delivery'}</option>
                          </select>
                        </Field>
                        <Field label={lang === 'he' ? 'כתובת' : 'Address'}><input name="address" dir="auto" maxLength={300} defaultValue={l.address ?? ''} className={input} /></Field>
                        <Field label={lang === 'he' ? 'תאריך' : 'Date'}><input name="date" type="date" defaultValue={l.scheduledFor ?? ''} className={input} /></Field>
                        <Field label={lang === 'he' ? 'חלון זמן' : 'Time window'}><input name="window" dir="auto" maxLength={60} defaultValue={l.timeWindow ?? ''} className={input} /></Field>
                      </ActionForm>
                    </details>
                  </div>
                ) : null}
                {kept > 0 && may.money ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer py-2 text-muted">{t.returnIt}</summary>
                    <ActionForm action={returnLineAction} hidden={{ lineId: l.id, returned: l.returnedQty }} label={t.doReturn} busy={t.saving} confirm={t.returnConfirm} className="mt-2 grid gap-2 sm:grid-cols-2">
                      {kept > 1 ? <Field label={`${t.units} (≤ ${kept})`}><input name="units" type="number" min={1} max={kept} defaultValue={kept} dir="ltr" className={input} /></Field> : <input type="hidden" name="units" value={1} />}
                      <Field label={t.putIn}><LocationSelect locations={locations} defaultValue={it?.locationId} emptyLabel={lang === 'he' ? 'ללא מיקום' : 'No location'} /></Field>
                      <div className="sm:col-span-2"><Field label={t.reason}><input name="reason" required minLength={3} dir="auto" maxLength={500} className={input} /></Field></div>
                    </ActionForm>
                  </details>
                ) : null}
              </li>
            )
          })}
        </ul>
        {v.sale.note ? <p dir="auto" className="text-sm text-muted">{v.sale.note}</p> : null}
      </section>

      <section className={box}>
        <h2 className="flex items-center justify-between text-sm font-semibold text-ink">{t.money}<span className={m.state === 'paid' || m.state === 'nothing_due' ? 'text-ok' : 'text-warn'}>{stateLabel}</span></h2>
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted">{t.total}</dt><dd className="num">{formatAgorot(m.totalMinor)}</dd>
          {m.returnedMinor ? <><dt className="text-muted">{t.returnedValue}</dt><dd className="num">−{formatAgorot(m.returnedMinor)}</dd></> : null}
          <dt className="text-muted">{t.due}</dt><dd className="num">{formatAgorot(m.dueMinor)}</dd>
          <dt className="text-muted">{t.paid}</dt><dd className="num">{formatAgorot(m.paidMinor)}</dd>
          <dt className="font-medium text-ink">{m.balanceMinor < 0 ? t.refundOwed : t.balance}</dt><dd className={`num font-semibold ${m.balanceMinor !== 0 ? 'text-warn' : ''}`}>{formatAgorot(Math.abs(m.balanceMinor))}</dd>
        </dl>
        <h3 className="text-sm font-semibold text-ink">{t.payments}</h3>
        {v.payments.length === 0 ? <p className="text-sm text-muted">{t.noPayments}</p> : (
          <ul className="flex flex-col gap-1 text-sm">
            {v.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap justify-between gap-x-3">
                <span>{methodLabel[p.method]} · <span className="text-muted">{formatDateTime(p.at, lang)}</span>{p.note ? <span dir="auto" className="text-muted"> · {p.note}</span> : null}</span>
                <span className={`num ${p.amountMinor < 0 ? 'text-bad' : ''}`}>{p.amountMinor < 0 ? '−' : ''}{formatAgorot(Math.abs(p.amountMinor))}</span>
              </li>
            ))}
          </ul>
        )}
        {may.money ? (
          <>
            <details open={m.balanceMinor > 0} className="text-sm">
              <summary className="cursor-pointer py-2 font-medium">{t.recordPayment}</summary>
              <PaymentForm saleId={v.sale.id} kind="payment" amount={m.balanceMinor > 0 ? m.balanceMinor : null} lang={lang} methodLabel={methodLabel} />
            </details>
            <details open={m.balanceMinor < 0} className="text-sm">
              <summary className="cursor-pointer py-2 font-medium">{t.recordRefund}</summary>
              <p className="text-meta text-muted">{t.refundHint}</p>
              <PaymentForm saleId={v.sale.id} kind="refund" amount={m.balanceMinor < 0 ? -m.balanceMinor : null} lang={lang} methodLabel={methodLabel} />
            </details>
          </>
        ) : null}
      </section>
    </div>
  )
}

function PaymentForm({ saleId, kind, amount, lang, methodLabel }: { saleId: string; kind: 'payment' | 'refund'; amount: number | null; lang: Lang; methodLabel: Record<string, string> }) {
  const t = SALE_COPY[lang]
  // One rendered form = one request id: a double click records once; the page re-renders with a new id after a save.
  return (
    <ActionForm action={paymentAction} hidden={{ saleId, kind, requestId: randomUUID() }} label={t.save} busy={t.saving} tone={kind === 'payment' ? 'primary' : 'plain'} className="mt-2 grid gap-2 sm:grid-cols-2">
      <Field label={t.amount}><input name="amount" required inputMode="decimal" dir="ltr" defaultValue={amount ? String(amount / 100) : ''} className={input} /></Field>
      <Field label={t.method}>
        <select name="method" defaultValue="cash" className={input}>{PAYMENT_METHODS.map((k) => <option key={k} value={k}>{methodLabel[k]}</option>)}</select>
      </Field>
      <div className="sm:col-span-2"><Field label={t.note}><input name="note" dir="auto" maxLength={300} className={input} /></Field></div>
    </ActionForm>
  )
}
