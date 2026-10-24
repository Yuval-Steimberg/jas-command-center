import { HandoverCard } from '@/components/shop/handover-card'
import { getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { handoverQueue } from '@/lib/sales/views'
import { handoverCounts } from '@/lib/sales/handovers'

export const dynamic = 'force-dynamic'

/**
 * מסירות: everything sold and not yet with its buyer, from the counter and
 * from the website alike, overdue first. The same list the home screen counts.
 */
export default async function ShopDeliveriesPage() {
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const res = await loadOps(() => handoverQueue({ crm: may('crm:read'), pii: may('crm:read_pii') }))
  if (!res.ok) return <p role="alert" dir="auto" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{res.message}</p>
  const { list, contacts } = res.data
  const n = handoverCounts(list)
  const groups = [
    { key: 'pickup', title: 'איסוף עצמי', rows: list.filter((h) => h.kind === 'pickup'), empty: 'אין פריטים שממתינים לאיסוף.' },
    { key: 'delivery', title: 'משלוחים', rows: list.filter((h) => h.kind === 'delivery'), empty: 'אין משלוחים פתוחים.' },
  ]
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">מסירות</h1>
        <p className="text-sm text-muted">{list.length === 0 ? 'הכול נמסר.' : `${list.length} ממתינים${n.overdue ? ` · ${n.overdue} באיחור` : ''}`}</p>
      </div>
      {groups.map((g) => (
        <section key={g.key} className="flex flex-col gap-2" aria-labelledby={`h-${g.key}`}>
          <h2 id={`h-${g.key}`} className="flex items-center gap-2 text-base font-bold text-ink">
            {g.title}
            <span className="num inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sunken px-2 text-xs font-semibold text-muted">{g.rows.length}</span>
          </h2>
          {g.rows.length === 0 ? <p className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-muted">{g.empty}</p> : (
            <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {g.rows.map((h) => <HandoverCard key={h.key} h={h} contact={h.contactId ? contacts.get(h.contactId) ?? null : null} operate={may('inventory:operate')} pii={may('crm:read_pii')} />)}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
