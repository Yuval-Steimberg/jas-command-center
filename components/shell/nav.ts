import type { Permission } from '@/lib/auth/rbac'

/**
 * The one map of the console: the sidebar, the section tabs, the page search,
 * the home page's shortcuts and the Guide all read it, so a page added here
 * shows up everywhere at once.
 *
 * Grouped by the job a person came to do (sell, stock, people…), never by
 * which system holds the data. Labels are plain words; `hint` says in one line
 * what the place is for. Hiding an entry is presentation only: every page and
 * action re-checks its own permission on the server.
 */

export type NavIcon =
  | 'home' | 'crm' | 'inventory' | 'sales' | 'shop' | 'truck' | 'tasks' | 'supplier' | 'volunteers' | 'website' | 'agent' | 'furniture'
  | 'map' | 'gift' | 'analytics' | 'report' | 'assistant' | 'bell' | 'plug' | 'settings' | 'guide'

export interface NavItem {
  href: string
  label: string
  hint: string
  icon: NavIcon
  permission?: Permission
}

export interface NavGroup {
  section: string
  items: NavItem[]
  /** Pinned to the bottom of the sidebar (alerts, status, settings, guide). */
  footer?: boolean
}

export const NAV: NavGroup[] = [
  { section: '', items: [{ href: '/', label: 'Home', hint: 'Start a task and see what needs you', icon: 'home' }] },
  {
    section: 'Sell',
    items: [
      { href: '/shop', label: 'Shop counter', hint: 'Sell, add and scan items at the counter', icon: 'shop', permission: 'inventory:read' },
      { href: '/website', label: 'Website', hint: 'Online orders, products, texts, blog, reviews, messages', icon: 'website', permission: 'website:read' },
      { href: '/sales', label: 'Sales', hint: 'Every in-store sale, payments and returns', icon: 'sales', permission: 'inventory:read' },
      { href: '/deliveries', label: 'Deliveries', hint: 'Pickups and deliveries to plan and hand over', icon: 'truck', permission: 'inventory:read' },
    ],
  },
  {
    section: 'Stock',
    items: [
      { href: '/inventory', label: 'Items', hint: 'Everything in storage: add, find, price, label', icon: 'inventory', permission: 'inventory:read' },
      { href: '/suppliers', label: 'Suppliers', hint: 'Who we buy from, purchase orders, receiving', icon: 'supplier', permission: 'inventory:read' },
    ],
  },
  {
    section: 'People',
    items: [
      { href: '/crm', label: 'Customers', hint: 'Contacts, leads and their history', icon: 'crm', permission: 'crm:read' },
      { href: '/volunteers', label: 'Volunteers', hint: 'Activities, shifts and attendance', icon: 'volunteers', permission: 'volunteers:read' },
      { href: '/tasks', label: 'Tasks', hint: 'To-dos for the team, including automatic ones', icon: 'tasks', permission: 'inventory:read' },
    ],
  },
  {
    section: 'Projects',
    items: [
      { href: '/furniture', label: 'Furniture collection', hint: 'Buildings we collect from, items and progress', icon: 'furniture', permission: 'furniture:read' },
      { href: '/gift-cards', label: 'Gift cards', hint: 'Find a card, resend it, check its balance', icon: 'gift', permission: 'gift_cards:read' },
      { href: '/map', label: 'Neighbourhood map', hint: 'The places on the public route map', icon: 'map', permission: 'map:read' },
      { href: '/design-agent', label: 'Design agent', hint: 'The WhatsApp design assistant and its jobs', icon: 'agent', permission: 'design_agent:read' },
    ],
  },
  {
    section: 'Numbers',
    items: [
      { href: '/analytics', label: 'Analytics', hint: 'Sales, visitors and progress over time', icon: 'analytics' },
      { href: '/reports', label: 'Reports', hint: 'Daily, weekly and monthly summaries', icon: 'report' },
      { href: '/assistant', label: 'Ask the AI', hint: 'Ask a question about any system in plain words', icon: 'assistant', permission: 'assistant:use' },
    ],
  },
  {
    section: 'Help and setup',
    footer: true,
    items: [
      { href: '/guide', label: 'Guide', hint: 'How the work flows, step by step', icon: 'guide' },
      { href: '/notifications', label: 'Alerts', hint: 'Problems the systems found', icon: 'bell' },
      { href: '/integrations', label: 'System status', hint: 'Is every connected system working', icon: 'plug', permission: 'integrations:read' },
      { href: '/settings', label: 'Settings', hint: 'Your account, staff and email alerts', icon: 'settings' },
    ],
  },
]

export interface SectionTab {
  href: string
  label: string
  permission?: Permission
}

/**
 * Pages inside a section, shown as tabs under the top bar on every page of
 * that section. Before these, pages like website orders or inventory intake
 * were reachable only from a link on another page. Each tab carries the same
 * permission its page asks for (`requirePageAccess`).
 */
export const SECTIONS: { base: string; tabs: SectionTab[] }[] = [
  {
    base: '/website',
    tabs: [
      { href: '/website', label: 'Overview' },
      { href: '/website/orders', label: 'Orders' },
      { href: '/website/products', label: 'Products' },
      { href: '/website/content', label: 'Texts and images' },
      { href: '/website/blog', label: 'Blog' },
      { href: '/website/reviews', label: 'Reviews' },
      { href: '/website/marketing', label: 'Marketing' },
      { href: '/website/inquiries', label: 'Messages' },
    ],
  },
  {
    base: '/inventory',
    tabs: [
      { href: '/inventory', label: 'All items' },
      { href: '/inventory/new', label: 'Add an item', permission: 'inventory:write' },
      { href: '/inventory/intake', label: 'Intake from collections', permission: 'inventory:operate' },
      { href: '/inventory/scan', label: 'Scan' },
      { href: '/inventory/labels', label: 'Labels' },
      { href: '/inventory/locations', label: 'Locations' },
      { href: '/inventory/website', label: 'From the website', permission: 'inventory:operate' },
      { href: '/inventory/online', label: 'Website shop', permission: 'website:write' },
    ],
  },
  {
    base: '/sales',
    tabs: [
      { href: '/sales', label: 'All sales' },
      { href: '/sales/new', label: 'New sale', permission: 'inventory:financial' },
    ],
  },
  {
    base: '/suppliers',
    tabs: [
      { href: '/suppliers', label: 'Suppliers and orders' },
      { href: '/suppliers/orders/new', label: 'New purchase order', permission: 'inventory:write' },
    ],
  },
  {
    base: '/crm',
    tabs: [
      { href: '/crm', label: 'Contacts' },
      { href: '/crm/pipeline', label: 'Leads pipeline' },
      { href: '/crm/new', label: 'Add a contact', permission: 'crm:write' },
    ],
  },
  {
    base: '/volunteers',
    tabs: [
      { href: '/volunteers', label: 'Overview' },
      { href: '/volunteers/activities', label: 'Activities' },
      { href: '/volunteers/calendar', label: 'Calendar' },
      { href: '/volunteers/people', label: 'Volunteers' },
      { href: '/volunteers/reports', label: 'Reports' },
    ],
  },
  {
    base: '/furniture',
    tabs: [
      { href: '/furniture', label: 'Projects' },
      { href: '/furniture/new', label: 'New project', permission: 'furniture:write' },
    ],
  },
  {
    base: '/settings',
    tabs: [
      { href: '/settings', label: 'Account' },
      { href: '/settings/staff', label: 'Staff', permission: 'users:manage' },
      { href: '/settings/notifications', label: 'Email alerts' },
    ],
  },
]

const under = (path: string, href: string) => path === href || path.startsWith(`${href}/`)

/** The section a path belongs to, if it has tabs. */
export function sectionOf(path: string) {
  return SECTIONS.find((s) => under(path, s.base)) ?? null
}

/** The tab to highlight: the longest tab path the current path sits under. */
export function activeTab(path: string, tabs: SectionTab[]): string | null {
  return tabs.filter((t) => under(path, t.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null
}

/** The sidebar entry to highlight. Home only on `/` exactly. */
export function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : under(path, href)
}

export interface StartTask {
  href: string
  label: string
  hint: string
  icon: NavIcon
  permission?: Permission
}

/**
 * The home page's "What do you want to do?" buttons, most common first. Each
 * names a job in the words staff use and opens the page that does it; its
 * permission is that page's own, so nobody is shown a button that leads to
 * "not allowed".
 */
export const START_TASKS: StartTask[] = [
  { href: '/shop/sell', label: 'Make a sale', hint: 'At the counter, cash or card', icon: 'shop', permission: 'inventory:financial' },
  { href: '/inventory/new', label: 'Add an item', hint: 'Photo, details and price', icon: 'inventory', permission: 'inventory:write' },
  { href: '/inventory/scan', label: 'Find an item', hint: 'Scan its label or type its code', icon: 'inventory', permission: 'inventory:read' },
  { href: '/inventory/intake', label: 'Take in a collection', hint: 'Items arriving from a building', icon: 'furniture', permission: 'inventory:operate' },
  { href: '/deliveries', label: 'Hand over or deliver', hint: 'Pickups and deliveries waiting', icon: 'truck', permission: 'inventory:read' },
  { href: '/website/orders', label: 'Handle website orders', hint: 'Pack, ship, mark as done', icon: 'website', permission: 'website:read' },
  { href: '/website/inquiries', label: 'Answer website messages', hint: 'Contact, volunteer and donation forms', icon: 'website', permission: 'website:read_pii' },
  { href: '/crm/new', label: 'Add a customer', hint: 'Name, phone, what they want', icon: 'crm', permission: 'crm:write' },
  { href: '/volunteers/activities/new', label: 'Plan a volunteer activity', hint: 'Shifts people can join', icon: 'volunteers', permission: 'volunteers:write' },
  { href: '/gift-cards', label: 'Look up a gift card', hint: 'Balance, resend, fix the recipient', icon: 'gift', permission: 'gift_cards:read' },
  { href: '/furniture', label: 'Check a furniture project', hint: 'Buildings, items, progress', icon: 'furniture', permission: 'furniture:read' },
  { href: '/analytics', label: 'See the numbers', hint: 'Sales and visitors over time', icon: 'analytics' },
]
