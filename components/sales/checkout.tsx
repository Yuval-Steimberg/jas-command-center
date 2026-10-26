'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormState } from 'react-dom'
import { Check, Plus, Search, UserPlus, X } from 'lucide-react'
import { Submit, input } from '@/app/(app)/website/forms'
import { Outcome } from '@/app/(app)/inventory/forms'
import { createSaleAction } from '@/app/(app)/sales/actions'
import type { ActionState } from '@/lib/ops/act'
import { formatAgorot } from '@/lib/money'
import { MAX_COUPON, METHOD_LABEL, PAYMENT_METHODS, discountFromInput, type Fulfilment, type PaymentMethod } from '@/lib/sales/model'
import { COPY, SALE_COPY, METHOD_LABEL_HE, minorToShekels, shekelsToMinor, type Lang } from './copy'
import { closeTerminalTab, openTerminalTab } from './terminal-tab'

export interface CheckoutItem {
  id: string
  sku: string
  title: string
  category: string | null
  colors: string | null
  material: string | null
  photoUrl: string | null
  priceMinor: number | null
  quantity: number
  kind: 'unique' | 'batch'
  status: 'in_storage' | 'listed' | 'reserved'
  version: number
  location: string | null
}

interface Line {
  itemId: string
  qty: number
  price: string
  fulfilment: Fulfilment
  address: string
  date: string
  window: string
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[֑-ׇ'"׳״-]/g, '')

/**
 * The shop counter: build a basket of items (units from a lot), price each
 * line, say how each line leaves the shop, pick or add the customer and
 * record what was paid now. The server re-checks every item under a lock and
 * sells the whole basket or none of it.
 *
 * With the card terminal connected, "card" means the terminal: the sale is
 * created and the amount is pushed to the terminal in the same tap, and the
 * payment is recorded when Grow reports it (never by this form).
 */
export function Checkout({ items, contacts, allowNewContact, lang, base, preselect, requestId, terminalDevices = [] }: {
  items: CheckoutItem[]
  contacts: { id: string; label: string }[]
  allowNewContact: boolean
  lang: Lang
  base: '/sales' | '/shop'
  preselect: string[]
  requestId: string
  /** The card terminal's device names; empty = not connected. */
  terminalDevices?: string[]
}) {
  const t = COPY[lang]
  const ts = SALE_COPY[lang]
  const methodLabel = lang === 'he' ? METHOD_LABEL_HE : METHOD_LABEL
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const lineFor = (i: CheckoutItem): Line => ({ itemId: i.id, qty: 1, price: minorToShekels(i.priceMinor), fulfilment: 'pickup', address: '', date: '', window: '' })
  const [lines, setLines] = useState<Line[]>(() => preselect.map((id) => byId.get(id)).filter((i): i is CheckoutItem => !!i).map(lineFor))
  const [q, setQ] = useState('')
  const [contactId, setContactId] = useState('')
  const [nc, setNc] = useState({ name: '', phone: '', email: '' })
  const [ncOpen, setNcOpen] = useState(false)
  const [payMode, setPayMode] = useState<'none' | 'all' | 'part'>('all')
  const [payAmount, setPayAmount] = useState('')
  const terminalOn = terminalDevices.length > 0
  const [method, setMethod] = useState<PaymentMethod>(terminalOn ? 'card' : 'cash')
  const [device, setDevice] = useState(terminalDevices[0] ?? '')
  const [note, setNote] = useState('')
  const [coupon, setCoupon] = useState('')
  const [discKind, setDiscKind] = useState<'amount' | 'percent'>('amount')
  const [discValue, setDiscValue] = useState('')
  const [state, run] = useFormState<ActionState, FormData>(createSaleAction, {})
  // A refused sale never reaches the terminal: close the tab the tap opened for it.
  useEffect(() => {
    if (state.ok === false) closeTerminalTab()
  }, [state])

  const inBasket = new Set(lines.map((l) => l.itemId))
  const words = norm(q).split(/\s+/).filter(Boolean)
  const found = items.filter((i) => !inBasket.has(i.id) && words.every((w) => [i.sku, i.title, i.category, i.colors, i.material].some((f) => norm(f).includes(w)))).slice(0, 30)

  const grossMinor = lines.reduce((a, l) => a + (shekelsToMinor(l.price) ?? 0) * l.qty, 0)
  const discountMinor = discountFromInput(discKind, discValue, grossMinor)
  const totalMinor = grossMinor - Math.min(discountMinor ?? 0, grossMinor)
  const paidMinor = payMode === 'all' ? totalMinor : payMode === 'part' ? (shekelsToMinor(payAmount) ?? 0) : 0
  const toTerminal = terminalOn && method === 'card' && paidMinor > 0
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const lastDelivery = [...lines].reverse().find((l) => l.fulfilment === 'delivery' && l.address)

  const problem =
    !lines.length ? t.emptyBasket
    : lines.some((l) => shekelsToMinor(l.price) == null) ? t.needPrice
    : lines.some((l) => l.fulfilment === 'delivery' && !l.address.trim()) ? t.needAddress
    : discountMinor == null ? t.badDiscount
    : discountMinor > grossMinor ? t.discountTooBig
    : payMode === 'part' && !(paidMinor > 0) ? t.needAmount
    : null

  const basket = JSON.stringify({
    requestId,
    contactId: contactId || null,
    newContact: !contactId && (nc.phone.trim() || nc.email.trim()) ? nc : null,
    note: note.trim() || null,
    lines: lines.map((l) => {
      const it = byId.get(l.itemId)!
      return {
        itemId: l.itemId, version: it.version, quantity: l.qty, unitPriceMinor: shekelsToMinor(l.price) ?? 0, fulfilment: l.fulfilment,
        address: l.fulfilment === 'delivery' ? l.address.trim() || null : null, scheduledFor: l.fulfilment === 'delivery' ? l.date || null : null, timeWindow: l.fulfilment === 'delivery' ? l.window.trim() || null : null,
      }
    }),
    discountMinor: discountMinor ?? 0,
    couponCode: coupon.trim() || null,
    payment: paidMinor > 0 && !toTerminal ? { amountMinor: paidMinor, method, note: null } : null,
    terminal: toTerminal ? { amountMinor: paidMinor, device: device || null } : null,
  })

  const seg = (on: boolean) => `h-11 flex-1 rounded-full border px-3 text-sm font-medium transition-colors duration-150 ${on ? 'border-forest bg-forest text-cream' : 'border-line hover:bg-sunken'}`
  // Once the basket has something in it the list folds away until the seller types, so the basket sits under the search.
  const showList = q.trim() !== '' || lines.length === 0
  const shop = base === '/shop'

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section className="flex min-w-0 flex-col gap-2 rounded-lg border border-line bg-surface p-3">
        <h2 className="text-sm font-semibold text-ink">{lines.length ? t.addMore : t.findItems}</h2>
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-faint" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.findHint} dir={lang === 'he' ? 'rtl' : 'ltr'} enterKeyHint="search" className={`${input.replace('px-3', 'pe-3 ps-10')} h-12`} aria-label={t.findItems} />
        </div>
        {!showList ? null : found.length === 0 ? <p className="text-sm text-muted">{t.noMatch}</p> : (
          <ul className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
            {found.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => { setLines((ls) => [...ls, lineFor(i)]); setQ('') }} className="flex min-h-14 w-full items-center gap-3 rounded-md px-2 py-1 text-start hover:bg-sunken">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {i.photoUrl ? <img src={i.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" /> : <span className="h-12 w-12 shrink-0 rounded bg-sunken" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink" dir="auto">{i.title}</span>
                    <span className="block truncate text-xs text-muted"><span dir="ltr">{i.sku}</span>{i.category ? ` · ${i.category}` : ''}{i.kind === 'batch' ? ` · ${i.quantity} ${t.qty}` : ''}{i.status !== 'in_storage' ? ` · ${i.status === 'listed' ? 'web' : t.reservedWarn}` : ''}</span>
                  </span>
                  <span className="num text-sm">{i.priceMinor != null ? formatAgorot(i.priceMinor) : '—'}</span>
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-forest"><Plus aria-hidden className="h-4 w-4" /></span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={run} onSubmit={() => { if (toTerminal) openTerminalTab(ts.terminalOpening) }} className="flex min-w-0 flex-col gap-3">
        <input type="hidden" name="basket" value={basket} />
        <input type="hidden" name="base" value={base} />
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">{t.basket}{lines.length ? <span className="num inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sage-soft px-2 text-xs text-forest">{lines.length}</span> : null}</h2>
          {lines.length === 0 ? <p className="text-sm text-muted">{t.emptyBasket}</p> : lines.map((l, i) => {
            const it = byId.get(l.itemId)!
            return (
              <div key={l.itemId} className="flex flex-col gap-2 rounded-md border border-line/70 bg-ground/40 p-2">
                <div className="flex items-start gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {it.photoUrl ? <img src={it.photoUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" /> : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink" dir="auto">{it.title}</p>
                    <p className="text-xs text-muted"><span dir="ltr">{it.sku}</span>{it.priceMinor != null ? ` · ${t.listed} ${formatAgorot(it.priceMinor)}` : ''}</p>
                    {it.status === 'listed' ? <p className="text-xs text-warn">{t.listedWarn}</p> : null}
                  </div>
                  <button type="button" aria-label={`${t.remove} ${it.sku}`} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-muted hover:bg-sunken">
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {it.kind === 'batch' ? (
                    <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t.qty} ({t.of} {it.quantity})</span>
                      <input type="number" min={1} max={it.quantity} value={l.qty} onChange={(e) => set(i, { qty: Math.max(1, Math.min(it.quantity, Math.floor(Number(e.target.value) || 1))) })} dir="ltr" className={input} />
                    </label>
                  ) : null}
                  <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t.price}</span>
                    <input value={l.price} onChange={(e) => set(i, { price: e.target.value })} inputMode="decimal" dir="ltr" className={input} />
                  </label>
                  <div className="col-span-2 flex items-end gap-2 sm:col-span-1">
                    <button type="button" className={seg(l.fulfilment === 'pickup')} onClick={() => set(i, { fulfilment: 'pickup' })}>{t.pickup}</button>
                    <button type="button" className={seg(l.fulfilment === 'delivery')} onClick={() => set(i, { fulfilment: 'delivery', address: l.address || lastDelivery?.address || '', date: l.date || lastDelivery?.date || '', window: l.window || lastDelivery?.window || '' })}>{t.delivery}</button>
                  </div>
                </div>
                {l.fulfilment === 'delivery' ? (
                  <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr]">
                    <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t.address}</span><input value={l.address} onChange={(e) => set(i, { address: e.target.value })} dir="auto" maxLength={300} className={input} /></label>
                    <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t.date}</span><input type="date" value={l.date} onChange={(e) => set(i, { date: e.target.value })} className={input} /></label>
                    <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t.window}</span><input value={l.window} onChange={(e) => set(i, { window: e.target.value })} dir="auto" maxLength={60} placeholder="10:00–13:00" className={input} /></label>
                  </div>
                ) : null}
              </div>
            )
          })}
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <label className="flex flex-col gap-1 text-sm"><span className="font-semibold text-ink">{t.customer}</span>
            <select value={contactId} onChange={(e) => setContactId(e.target.value)} className={input}>
              <option value="">{t.pickCustomer}</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </label>
          {!contactId && allowNewContact && !ncOpen ? (
            <button type="button" onClick={() => setNcOpen(true)} className="inline-flex h-11 items-center gap-2 self-start rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken"><UserPlus aria-hidden className="h-4 w-4" />{t.newCustomer}</button>
          ) : null}
          {!contactId && allowNewContact && ncOpen ? (
            <fieldset className="grid gap-2 sm:grid-cols-3">
              <legend className="mb-1 text-xs text-muted">{t.newCustomer}</legend>
              <input value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} placeholder={t.name} aria-label={t.name} dir="auto" maxLength={200} className={input} />
              <input value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} placeholder={t.phone} aria-label={t.phone} dir="ltr" inputMode="tel" maxLength={40} className={input} />
              <input value={nc.email} onChange={(e) => setNc({ ...nc, email: e.target.value })} placeholder={t.email} aria-label={t.email} dir="ltr" type="email" maxLength={200} className={input} />
            </fieldset>
          ) : null}
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <h2 className="text-sm font-semibold text-ink">{t.discount}</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t.coupon}</span>
              <input value={coupon} onChange={(e) => setCoupon(e.target.value)} dir="auto" maxLength={MAX_COUPON} autoCapitalize="characters" autoComplete="off" spellCheck={false} className={input} />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <label htmlFor="sale-discount" className="text-muted">{t.specialDiscount}</label>
              <div className="flex gap-2">
                <input id="sale-discount" value={discValue} onChange={(e) => setDiscValue(e.target.value)} inputMode="decimal" dir="ltr" placeholder="0" className={`${input} min-w-0 flex-1`} />
                <div role="group" aria-label={t.discountKind} className="flex shrink-0 gap-1">
                  <button type="button" aria-pressed={discKind === 'amount'} className={`${seg(discKind === 'amount')} w-11 flex-none px-0`} onClick={() => setDiscKind('amount')}>₪</button>
                  <button type="button" aria-pressed={discKind === 'percent'} className={`${seg(discKind === 'percent')} w-11 flex-none px-0`} onClick={() => setDiscKind('percent')}>%</button>
                </div>
              </div>
              {discKind === 'percent' && discountMinor ? <span className="num text-xs text-muted">= {formatAgorot(discountMinor)}</span> : null}
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <h2 className="text-sm font-semibold text-ink">{t.payment}</h2>
          <div className="flex gap-2">
            <button type="button" className={seg(payMode === 'all')} onClick={() => setPayMode('all')}>{t.payAll}</button>
            <button type="button" className={seg(payMode === 'part')} onClick={() => setPayMode('part')}>{t.amount}</button>
            <button type="button" className={seg(payMode === 'none')} onClick={() => setPayMode('none')}>{t.payNothing}</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {payMode === 'part' ? <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t.amount}</span><input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} inputMode="decimal" dir="ltr" className={input} /></label> : null}
            {payMode !== 'none' ? (
              <fieldset className="flex flex-col gap-1 text-sm sm:col-span-2">
                <legend className="mb-1 text-muted">{t.method}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHODS.map((k) => (
                    <button key={k} type="button" aria-pressed={method === k} onClick={() => setMethod(k)} className={`inline-flex min-h-11 items-center justify-center gap-1 rounded-md border px-2 text-center text-sm leading-tight transition-colors duration-150 ${method === k ? 'border-forest bg-forest font-semibold text-cream' : 'border-line hover:bg-sunken'}`}>
                      {method === k ? <Check aria-hidden className="h-4 w-4 shrink-0" /> : null}{k === 'card' && terminalOn ? ts.terminalMethod : methodLabel[k]}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            {toTerminal && terminalDevices.length > 1 ? (
              <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{ts.terminalDevice}</span>
                <select value={device} onChange={(e) => setDevice(e.target.value)} className={input}>{terminalDevices.map((d) => <option key={d} value={d}>{d}</option>)}</select>
              </label>
            ) : null}
            {toTerminal ? <p className="text-sm text-muted sm:col-span-2">{ts.terminalAuto}{paidMinor > 30000 ? ` ${ts.terminalTapCap}` : ''}</p> : null}
          </div>
          <label className="flex flex-col gap-1 text-sm"><span className="text-muted">{t.note}</span><input value={note} onChange={(e) => setNote(e.target.value)} dir="auto" maxLength={1000} className={input} /></label>
        </section>

        {/* Total and the sale button stay under the thumb; in shop mode they sit above the tab bar, never under it. */}
        <section className={`sticky z-10 flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 shadow-lift ${shop ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))]' : 'bottom-0'}`}>
          <dl className="flex items-end justify-between gap-3 text-sm">
            <div><dt className="text-muted">{t.total}{lines.length ? ` · ${lines.length === 1 ? t.oneItem : `${lines.length} ${t.itemsWord}`}` : ''}</dt><dd className="num text-2xl font-bold text-ink">{formatAgorot(totalMinor)}</dd>
              {discountMinor && discountMinor <= grossMinor ? <dd className="num text-xs text-muted">{formatAgorot(grossMinor)} − {t.discountShort} {formatAgorot(discountMinor)}</dd> : null}</div>
            <div className="text-end">
              <dt className="text-muted">{t.balance}</dt><dd className={`num text-base font-semibold ${totalMinor - paidMinor > 0 ? 'text-warn' : 'text-ok'}`}>{formatAgorot(totalMinor - paidMinor)}</dd>
            </div>
          </dl>
          {problem && lines.length ? <p role="status" className="text-sm font-medium text-warn">{problem}</p> : null}
          {problem ? <button type="button" disabled className="h-12 rounded-full bg-sunken px-4 text-base font-semibold text-muted">{t.sell}</button> : <BigSubmit label={toTerminal ? ts.sellToTerminal : t.sell} busy={t.selling} />}
          <Outcome state={state} />
        </section>
      </form>
    </div>
  )
}

function BigSubmit({ label, busy }: { label: string; busy: string }) {
  return (
    <div className="[&>button]:h-12 [&>button]:w-full [&>button]:text-base">
      <Submit label={label} busy={busy} tone="primary" />
    </div>
  )
}
