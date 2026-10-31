import { requireUser, getSession } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { Sidebar } from '@/components/shell/sidebar'
import { Topbar } from '@/components/shell/topbar'
import { SectionTabs } from '@/components/shell/section-tabs'
import { NAV, SECTIONS } from '@/components/shell/nav'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const overrides = (await getSession())?.overrides
  const may = (p?: Parameters<typeof can>[1]) => !p || can(user.role, p, overrides)
  // Hiding a link is presentation only; every page and action re-checks on the server.
  const nav = NAV.map((g) => ({ ...g, items: g.items.filter((i) => may(i.permission)) })).filter((g) => g.items.length)
  const sections = SECTIONS.map((s) => ({ ...s, tabs: s.tabs.filter((t) => may(t.permission)) }))
  return (
    <div className="flex min-h-dvh">
      <Sidebar groups={nav} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} nav={nav} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-3 py-5 sm:px-5 lg:px-8">
          <SectionTabs sections={sections} />
          {children}
        </main>
      </div>
    </div>
  )
}
