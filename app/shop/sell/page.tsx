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

export default async function ShopSellPage({ searchParams }: { searchParams: { item?: string | string[] } }) {
  await requirePageAccess('inventory:financial')
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  const res = await loadOps(() => checkoutData({ crm: may('crm:read'), pii: may('crm:read_pii') }))
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold text-ink">מכירה</h1>
      {!res.ok ? <p role="alert" dir="auto" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{res.message}</p> : (
        <Checkout items={res.data.items} contacts={res.data.contacts} allowNewContact={may('crm:write')} lang="he" base="/shop" preselect={([] as string[]).concat(searchParams.item ?? [])} requestId={res.data.requestId} terminalDevices={terminalDevices()} />
      )}
    </div>
  )
}
