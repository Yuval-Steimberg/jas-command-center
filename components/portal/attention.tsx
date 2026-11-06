import Link from 'next/link'
import { AlertTriangle, ChevronLeft } from 'lucide-react'
import { visibleAlerts } from '@/lib/live'
import { handoverQueue } from '@/lib/sales/views'
import type { Product } from '@/lib/auth/rbac'
import { cn } from '@/lib/cn'

const PRODUCT_HE: Record<Product, string> = {
  website: 'באתר',
  gift_cards: 'בשוברי המתנה',
  furniture: 'במיפוי ובפינוי',
  design_agent: 'בסוכן העיצוב',
  map: 'במפה',
  crm: 'בלקוחות',
  inventory: 'במלאי ובמכירה',
  volunteers: 'במתנדבים',
}

type Line = { text: string; href: string; urgent?: boolean; unknown?: boolean }

/**
 * The manager's "needs attention": a few sentences, each one tap from the
 * screen that fixes it. Only from sources that were actually read; a source
 * that could not be read says so instead of reading as "all clear". Nothing
 * is counted here: alerts come from the console's own sweep (lib/alerts.ts),
 * handovers from the shop's own queue.
 */
export async function Attention({ inventory }: { inventory: boolean }) {
  const lines: Line[] = []
  const [alerts, handovers] = await Promise.allSettled([visibleAlerts(), inventory ? handoverQueue({ crm: false, pii: false }) : Promise.resolve(null)])

  if (alerts.status === 'fulfilled') {
    const open = alerts.value.filter((a) => a.severity !== 'info')
    const by = new Map<Product, { n: number; critical: boolean; href: string }>()
    for (const a of open) {
      const x = by.get(a.product) ?? { n: 0, critical: false, href: a.href }
      by.set(a.product, { n: x.n + 1, critical: x.critical || a.severity === 'critical', href: x.href })
    }
    // One alert opens the screen that fixes it; several open the alert list.
    for (const [p, { n, critical, href }] of [...by].sort((a, b) => Number(b[1].critical) - Number(a[1].critical) || b[1].n - a[1].n))
      lines.push({ text: `${n === 1 ? 'דבר אחד דורש' : `${n} דברים דורשים`} בדיקה ${PRODUCT_HE[p]}`, href: n === 1 ? href : '/notifications', urgent: critical })
  } else lines.push({ text: 'לא הצלחנו לבדוק עכשיו אם יש תקלות במערכות', href: '/integrations', unknown: true })

  if (handovers.status === 'fulfilled' && handovers.value) {
    const n = handovers.value.list.length
    if (n) lines.push({ text: n === 1 ? 'פריט אחד שנמכר מחכה למסירה' : `${n} פריטים שנמכרו מחכים למסירה`, href: '/shop/deliveries' })
  } else if (handovers.status === 'rejected') lines.push({ text: 'לא הצלחנו לבדוק מסירות שמחכות', href: '/shop/deliveries', unknown: true })

  return (
    <section aria-labelledby="attention">
      <h2 id="attention" className="mb-2 text-sm font-bold text-ink">דורש תשומת לב</h2>
      {lines.length ? (
        <ul className="flex flex-col gap-2">
          {lines.slice(0, 5).map((l) => (
            <li key={l.text}>
              <Link
                href={l.href}
                className={cn(
                  'flex min-h-12 items-center gap-3 rounded-lg border bg-surface px-4 py-2 text-sm shadow-card hover:bg-sunken',
                  l.urgent ? 'border-bad/40 text-bad' : 'border-line text-ink',
                  l.unknown && 'text-muted',
                )}
              >
                <AlertTriangle aria-hidden className={cn('size-4 shrink-0', l.urgent ? 'text-bad' : l.unknown ? 'text-faint' : 'text-warn')} />
                <span className="flex-1">{l.text}</span>
                <ChevronLeft aria-hidden className="size-4 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">אין כרגע משהו שמחכה לטיפול.</p>
      )}
    </section>
  )
}

export function AttentionSkeleton() {
  return (
    <div aria-hidden>
      <div className="mb-2 h-4 w-28 rounded bg-sunken" />
      <div className="h-12 animate-pulse rounded-lg bg-sunken motion-reduce:animate-none" />
    </div>
  )
}
