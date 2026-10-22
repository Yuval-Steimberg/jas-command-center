import { requireUser, getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { Sidebar } from '@/components/shell/sidebar'
import { Topbar } from '@/components/shell/topbar'
import { NAV } from '@/components/shell/nav'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const overrides = (await getSession())?.overrides
  // Hiding a link is presentation only; every page and action re-checks on the server.
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || can(user.role, i.permission, overrides)) })).filter((g) => g.items.length)
  return (
    <div className="flex min-h-dvh">
      <Sidebar groups={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} nav={nav} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 sm:px-5 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
