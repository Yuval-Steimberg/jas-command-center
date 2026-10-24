import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { OpsUnavailable, btn, linkCls } from '@/components/ops/ui'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { contactLabel } from '@/lib/ops/views'
import { getOpsSnapshot } from '@/lib/ops/snapshot'
import { CONTACT_ROLES, type ContactRole } from '@/lib/ops/types'
import { ROLE_LABEL } from '@/lib/crm/model'
import { formatCount, timeAgo } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function CustomersPage({ searchParams }: { searchParams?: { q?: string; role?: string } }) {
  await requirePageAccess('crm:read')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const pii = may('crm:read_pii')
  const q = (typeof searchParams?.q === 'string' ? searchParams.q : '').trim().slice(0, 100)
  const role = CONTACT_ROLES.find((r) => r === searchParams?.role) as ContactRole | undefined
  // Without read_pii a search would reveal names by matching them, so it is offered only with it.
  const [res, snap] = await Promise.all([loadOps(() => getOpsStore().listContacts({ q: pii && q ? q : undefined, role, limit: 300 })), getOpsSnapshot()])

  return (
    <>
      <PageHeader
        title="Customers & contacts"
        description="One record per person, recognised by email or phone. Website orders and website forms add people here automatically (see Tasks → automations); WhatsApp chats are logged by hand, because the WhatsApp number in this system is the owner's design agent, not a customer inbox. Orders, gift cards and balances stay in their own systems and are read live on each contact."
        actions={
          <div className="flex flex-wrap gap-2">
            {may('crm:write') ? <Link href="/crm/new" className={btn}>Add a contact</Link> : null}
            <Link href="/crm/pipeline" className={btn}>Leads pipeline</Link>
          </div>
        }
      />
      {snap.state === 'ok' ? (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Kpi label="Contacts" value={formatCount(snap.data.crm.contacts)} />
          <Kpi label="Customers" value={formatCount(snap.data.crm.customers)} sub="bought at least once" />
          <Kpi label="Open leads" value={formatCount(snap.data.crm.openLeads)} />
          <Kpi label="Leads waiting 3+ days" value={formatCount(snap.data.crm.staleLeads)} tone={snap.data.crm.staleLeads ? 'warn' : undefined} sub="new, never contacted" />
        </div>
      ) : null}
      <Card>
        <CardHeader title="Contacts" meta={res.ok ? `${res.data.length} shown${res.data.length === 300 ? ' (first 300; narrow the search)' : ''}` : undefined} />
        <CardBody>
          <form action="/crm" className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
            {pii ? (
              <label className="min-w-0"><span className="sr-only">Search</span><input name="q" defaultValue={q} dir="auto" maxLength={100} placeholder="Name, email or phone" className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm" /></label>
            ) : (
              <p className="self-center text-sm text-muted">Names, emails and phones are hidden for your role.</p>
            )}
            <label><span className="sr-only">Role</span>
              <select name="role" defaultValue={role ?? ''} className="h-10 w-full rounded-md border border-line bg-surface px-2 text-sm">
                <option value="">Every role</option>
                {CONTACT_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </label>
            <button className={btn}>Filter</button>
          </form>
          {!res.ok ? <OpsUnavailable message={res.message} /> : res.data.length === 0 ? (
            <p className="text-sm text-muted">{q || role ? 'No contact matches.' : 'No contacts yet. They appear when a website order or form message is synced, or when someone adds one.'}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-start text-xs text-muted">
                  <tr><th className="py-2 text-start font-medium">Contact</th><th className="text-start font-medium">Roles</th><th className="text-start font-medium">Came from</th><th className="text-start font-medium">Updated</th></tr>
                </thead>
                <tbody>
                  {res.data.map((c) => (
                    <tr key={c.id} className="border-t border-line/60">
                      <td className="py-2"><Link href={`/crm/${c.id}`} className={linkCls} dir="auto">{contactLabel(c, pii)}</Link></td>
                      <td className="whitespace-nowrap">{c.roles.map((r) => ROLE_LABEL[r]).join(', ') || '—'}</td>
                      <td className="whitespace-nowrap text-muted">{c.source.replace('_', ' ')}</td>
                      <td className="whitespace-nowrap text-muted">{timeAgo(c.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  )
}
