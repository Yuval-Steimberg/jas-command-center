import Link from 'next/link'
import { PageHeader } from '@/components/ui/card'
import { OpsUnavailable, btn } from '@/components/ops/ui'
import { Checkout } from '@/components/sales/checkout'
import { getSession, requirePageAccess } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { loadOps } from '@/lib/ops/guard'
import { checkoutData } from '@/lib/sales/views'
import { growTerminalSetup } from '@/lib/sales/terminal'

export const dynamic = 'force-dynamic'

const terminalDevices = () => {
  const t = growTerminalSetup()
  return t.on ? t.config.devices.map((d) => d.name) : []
}

export default async function NewSalePage({ searchParams }: { searchParams: { item?: string | string[] } }) {
  await requirePageAccess('inventory:financial')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const res = await loadOps(() => checkoutData({ crm: may('crm:read'), pii: may('crm:read_pii') }))
  const preselect = ([] as string[]).concat(searchParams.item ?? [])
  return (
    <>
      <PageHeader
        title="New shop sale"
        description="One customer, one or more items, each picked up or delivered on its own day. Every item is checked under a lock: the whole basket is sold, or none of it. A listed item is taken off the website first."
        actions={<Link href="/sales" className={btn}>Sales</Link>}
      />
      {!res.ok ? <OpsUnavailable message={res.message} /> : (
        <Checkout items={res.data.items} contacts={res.data.contacts} allowNewContact={may('crm:write')} lang="en" base="/sales" preselect={preselect} requestId={res.data.requestId} terminalDevices={terminalDevices()} />
      )}
    </>
  )
}
