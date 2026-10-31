import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { getSession, requireUser } from '@/lib/auth/session'
import { can, ROLE_LABELS, type Permission } from '@/lib/auth/rbac'
import { NAV } from '@/components/shell/nav'
import { NAV_ICONS } from '@/components/shell/icons'

export const dynamic = 'force-dynamic'

interface Step {
  title: string
  body: string
  href?: string
  /** The permission the step's page asks for; without it the step is shown, unlinked. */
  permission?: Permission
  /** Happens outside this console (a customer, the field app, the gift card site). */
  elsewhere?: string
}

interface Flow {
  id: string
  title: string
  who: string
  steps: Step[]
}

/**
 * The work, end to end, in the order it happens. Every step names the page
 * that does it; this page describes the flows, it does not change any of them.
 */
const FLOWS: Flow[] = [
  {
    id: 'item',
    title: 'A piece of furniture, from a building to its new home',
    who: 'Project managers, the warehouse and the shop',
    steps: [
      { title: 'Collected', body: 'The field team photographs items in each apartment with the furniture app. Progress shows here per project.', href: '/furniture', permission: 'furniture:read', elsewhere: 'Furniture app' },
      { title: 'Taken into storage', body: 'When the truck arrives, take the items in. Each one gets its code (JAS-…) and a place in storage.', href: '/inventory/intake', permission: 'inventory:operate' },
      { title: 'Labelled', body: 'Print a label with a QR code and barcode, so anyone can scan it later.', href: '/inventory/labels', permission: 'inventory:read' },
      { title: 'Priced and put on sale', body: 'Set the price on the item, then list it on the website shop if it should sell online too.', href: '/inventory/online', permission: 'website:write' },
      { title: 'Sold', body: 'At the counter, or online. A website sale marks the item sold here on its own within the hour.', href: '/shop/sell', permission: 'inventory:financial' },
      { title: 'Handed over', body: 'The buyer picks it up, or it goes out on a planned delivery.', href: '/deliveries', permission: 'inventory:read' },
    ],
  },
  {
    id: 'counter',
    title: 'A sale at the counter',
    who: 'Shop sellers',
    steps: [
      { title: 'Open the shop counter', body: 'The Hebrew counter screen, built for a phone or tablet.', href: '/shop', permission: 'inventory:read' },
      { title: 'Add the items', body: 'Scan each label or search by name or code.', href: '/shop/sell', permission: 'inventory:financial' },
      { title: 'Take payment', body: 'Record cash, card or transfer. A sale sells every item in it or none.' },
      { title: 'Hand over now or later', body: 'Items not taken today wait under Deliveries until they leave the shop.', href: '/shop/deliveries', permission: 'inventory:read' },
      { title: 'Returns', body: 'Open the sale and return the item from there; the refund is recorded as a payment back.', href: '/sales', permission: 'inventory:read' },
    ],
  },
  {
    id: 'web-order',
    title: 'An order on the website',
    who: 'Whoever packs and ships',
    steps: [
      { title: 'The customer pays online', body: 'The website takes the payment and lowers the stock by itself.', elsewhere: 'Website' },
      { title: 'It appears under Website orders', body: 'Search it, add a note, and move it along: preparing, ready, shipped, done.', href: '/website/orders', permission: 'website:read' },
      { title: 'The item is marked sold here', body: 'The hourly sync finds the order and marks the item sold. If something does not add up, a task is opened instead of selling twice.', href: '/tasks', permission: 'inventory:read' },
      { title: 'Pickup or delivery', body: 'Plan it like any other handover.', href: '/deliveries', permission: 'inventory:read' },
    ],
  },
  {
    id: 'gift-card',
    title: 'A gift card',
    who: 'Managers; money actions are for the owner',
    steps: [
      { title: 'Bought online', body: 'The customer buys at the gift card site and pays by card.', elsewhere: 'Gift card site' },
      { title: 'Sent by email', body: 'The recipient gets the card with its code and a QR.', elsewhere: 'Gift card site' },
      { title: 'Spent in the shop', body: 'Staff scan the code in the gift card app; the balance goes down by what was spent.', elsewhere: 'Gift card app' },
      { title: 'Help a customer', body: 'Find the card, resend it, or fix the recipient email. Refunds and corrections are owner-only.', href: '/gift-cards', permission: 'gift_cards:read' },
    ],
  },
  {
    id: 'supplier',
    title: 'Buying from a supplier',
    who: 'Operations',
    steps: [
      { title: 'Write a purchase order', body: 'Pick the supplier and list what you ordered.', href: '/suppliers/orders/new', permission: 'inventory:write' },
      { title: 'Receive what arrived', body: 'Count what came in, even part of the order. Each unit becomes an item in storage.', href: '/suppliers', permission: 'inventory:read' },
      { title: 'Carry on as any item', body: 'Label, price and sell it like everything else.', href: '/inventory', permission: 'inventory:read' },
    ],
  },
  {
    id: 'volunteers',
    title: 'A volunteer activity',
    who: 'Volunteer coordinators and project managers',
    steps: [
      { title: 'Create the activity', body: 'Give it shifts, a place and how many people each shift needs.', href: '/volunteers/activities/new', permission: 'volunteers:write' },
      { title: 'Volunteers sign up', body: 'They join shifts in the volunteer app; a full shift puts them on the waiting list.', elsewhere: 'Volunteer app' },
      { title: 'On the day', body: 'Mark who came. Hours are counted only from attendance.', href: '/volunteers/calendar', permission: 'volunteers:read' },
    ],
  },
  {
    id: 'problems',
    title: 'When something looks wrong',
    who: 'Everyone',
    steps: [
      { title: 'Check Alerts', body: 'The bell at the top counts problems the systems found, such as a payment that did not match a card.', href: '/notifications' },
      { title: 'Check System status', body: 'Shows whether each connected system is answering. "Not connected" means it was never set up, not that it is empty.', href: '/integrations', permission: 'integrations:read' },
      { title: 'Ask the AI', body: 'Ask in plain words, for example "which website orders are still waiting?". It can look things up; changes need your click.', href: '/assistant', permission: 'assistant:use' },
    ],
  },
]

export default async function GuidePage() {
  const user = await requireUser()
  const overrides = (await getSession())?.overrides
  const may = (p?: Permission) => !p || can(user.role, p, overrides)
  const places = NAV.flatMap((g) => g.items.map((i) => ({ ...i, group: g.section })))
  return (
    <>
      <PageHeader
        title="Guide"
        description="How the work flows from start to finish, and where each step happens. Steps you can open are links; the rest are done by another role or in another app."
      />

      <nav aria-label="Flows on this page" className="mb-6 flex flex-wrap gap-2">
        {FLOWS.map((f) => (
          <a key={f.id} href={`#${f.id}`} className="inline-flex min-h-11 items-center rounded-full border border-line bg-surface px-4 text-sm text-ink hover:bg-sunken active:scale-[0.98]">
            {f.title}
          </a>
        ))}
      </nav>

      <div className="flex flex-col gap-4">
        {FLOWS.map((f) => (
          <Card key={f.id}>
            <div id={f.id} className="scroll-mt-20" />
            <CardHeader title={f.title} meta={f.who} />
            <CardBody>
              <ol className="flex flex-col">
                {f.steps.map((s, i) => {
                  const open = s.href && may(s.permission)
                  return (
                    <li key={s.title} className="relative flex gap-3 pb-4 last:pb-0">
                      {i < f.steps.length - 1 ? <span aria-hidden className="absolute start-[13px] top-7 bottom-0 w-px bg-line" /> : null}
                      <span aria-hidden className="num grid size-7 shrink-0 place-items-center rounded-full bg-sage-soft text-xs font-semibold text-forest">{i + 1}</span>
                      <div className="min-w-0 pt-0.5">
                        <div className="text-sm font-semibold text-ink">
                          {open ? (
                            <Link href={s.href!} className="underline decoration-line underline-offset-[3px] hover:decoration-ink">{s.title}</Link>
                          ) : (
                            s.title
                          )}
                        </div>
                        <p className="text-sm text-muted">{s.body}</p>
                        {s.elsewhere ? <p className="mt-0.5 text-xs text-faint">Happens in: {s.elsewhere}</p> : null}
                        {s.href && !open ? <p className="mt-0.5 text-xs text-faint">Done by another role</p> : null}
                      </div>
                    </li>
                  )
                })}
              </ol>
            </CardBody>
          </Card>
        ))}

        <Card>
          <div id="map" className="scroll-mt-20" />
          <CardHeader title="Every section, in one list" meta={`You are signed in as ${ROLE_LABELS[user.role]}. Sections your role cannot open are shown without a link.`} />
          <CardBody>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
              {places.map((p) => {
                const Icon = NAV_ICONS[p.icon]
                const open = may(p.permission)
                return (
                  <li key={p.href} className="flex min-h-11 items-start gap-2.5 py-1.5">
                    <Icon aria-hidden className={`mt-0.5 size-4 shrink-0 ${open ? 'text-forest' : 'text-faint'}`} strokeWidth={1.75} />
                    <div className="min-w-0">
                      {open ? (
                        <Link href={p.href} className="text-sm font-medium text-ink underline-offset-[3px] hover:underline">{p.label}</Link>
                      ) : (
                        <span className="text-sm font-medium text-muted">{p.label}</span>
                      )}
                      <span className="block text-xs text-muted">{p.hint}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  )
}
