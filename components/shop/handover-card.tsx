import Link from 'next/link'
import { Phone, Store, Truck } from 'lucide-react'
import { HandoverControls } from '@/components/sales/handover-controls'
import { Thumb } from '@/components/shop/bits'
import { formatDay } from '@/lib/format'
import type { Handover } from '@/lib/sales/handovers'

/** One thing to hand over: what, to whom (with a call button), when, and the buttons. */
export function HandoverCard({ h, contact, operate, pii }: { h: Handover; contact: { name: string; phone: string | null } | null; operate: boolean; pii: boolean }) {
  const title = h.item ? h.item.title : h.ref ? `הזמנה ${h.ref}` : 'פריט'
  const href = h.sale ? `/shop/sales/${h.sale.id}` : h.item ? `/shop/items/${h.item.id}` : null
  const qty = h.line && h.line.quantity > 1 ? ` ×${h.line.quantity}` : ''
  return (
    <li className={`flex min-w-0 flex-col gap-3 rounded-lg border bg-surface p-3 ${h.overdue ? 'border-bad/40' : 'border-line'}`}>
      <div className="flex items-start gap-3">
        <Thumb src={h.item?.photoUrl} />
        <div className="min-w-0 flex-1">
          {href ? <Link href={href} className="block truncate font-semibold text-ink underline-offset-2 hover:underline" dir="auto">{title}{qty}</Link> : <span className="block truncate font-semibold text-ink" dir="auto">{title}</span>}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {h.kind === 'delivery' ? <Truck aria-hidden className="h-3.5 w-3.5" /> : <Store aria-hidden className="h-3.5 w-3.5" />}
            <span>{h.kind === 'delivery' ? 'משלוח' : 'איסוף עצמי'}</span>
            {h.scheduledFor ? <span className="num" dir="ltr">{formatDay(h.scheduledFor)}{h.timeWindow ? ` ${h.timeWindow}` : ''}</span> : h.kind === 'delivery' ? <span>עוד בלי תאריך</span> : null}
            {h.ref ? <span dir="ltr">{h.ref}</span> : null}
            {h.delivery?.status === 'out' ? <span className="rounded-full border border-line px-2 py-0.5">בדרך</span> : null}
            {h.overdue ? <span className="rounded-full border border-bad/30 bg-bad/10 px-2 py-0.5 font-medium text-bad">באיחור</span> : null}
          </p>
          {contact ? <p className="mt-1 text-sm text-ink" dir="auto">{contact.name}</p> : null}
          {h.kind === 'delivery' && h.address && pii ? <p className="text-xs text-muted" dir="auto">{h.address}</p> : null}
        </div>
        {contact?.phone ? (
          <a href={`tel:${contact.phone}`} aria-label={`התקשרות ל${contact.name}`} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-sm text-ink hover:bg-sunken">
            <Phone aria-hidden className="h-4 w-4" /><span className="num hidden sm:inline" dir="ltr">{contact.phone}</span>
          </a>
        ) : null}
      </div>
      {operate ? <HandoverControls line={h.line} delivery={h.delivery} lang="he" strong /> : null}
    </li>
  )
}
