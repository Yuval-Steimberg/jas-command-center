import { formatAgorot } from '@/lib/money'
import { whatsappLink } from '@/lib/crm/model'
import type { Contact } from '@/lib/ops/types'
import type { PurchaseOrder } from './model'

/**
 * The order as plain text, to send to the supplier: lines, quantities and the
 * expected date. Unit costs are left out on purpose (the supplier quotes them).
 */
export function orderText(po: PurchaseOrder, opts: { business?: string } = {}): string {
  const lines = po.lines.map((l) => `• ${l.description} × ${l.quantity}`)
  return [
    `${opts.business ?? 'Just A Second'} · הזמנה ${po.number}`,
    '',
    ...lines,
    ...(po.expectedAt ? ['', `מועד אספקה מבוקש: ${po.expectedAt.split('-').reverse().join('/')}`] : []),
    ...(po.note ? ['', po.note] : []),
    '',
    'תודה',
  ].join('\n')
}

/** wa.me link that opens WhatsApp with the order typed in; nothing is sent until a person presses send there. */
export function orderWhatsAppLink(po: PurchaseOrder, supplier: Pick<Contact, 'phone'>): string | null {
  const base = whatsappLink(supplier.phone)
  return base ? `${base}?text=${encodeURIComponent(orderText(po))}` : null
}

export const mailtoOrder = (po: PurchaseOrder, supplier: Pick<Contact, 'email'>) =>
  supplier.email ? `mailto:${supplier.email}?subject=${encodeURIComponent(`הזמנה ${po.number}`)}&body=${encodeURIComponent(orderText(po))}` : null

export const money = (a: number) => formatAgorot(a)
