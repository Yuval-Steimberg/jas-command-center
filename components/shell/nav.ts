import type { Permission } from '@/lib/auth/rbac'

export interface NavItem {
  href: string
  label: string
  icon: 'overview' | 'crm' | 'inventory' | 'sales' | 'truck' | 'tasks' | 'supplier' | 'volunteers' | 'website' | 'agent' | 'furniture' | 'map' | 'gift' | 'analytics' | 'report' | 'assistant' | 'bell' | 'plug' | 'settings'
  permission?: Permission
}

export const NAV: { section: string; items: NavItem[] }[] = [
  { section: '', items: [{ href: '/', label: 'Overview', icon: 'overview' }] },
  {
    section: 'Operations',
    items: [
      { href: '/crm', label: 'Customers', icon: 'crm', permission: 'crm:read' },
      { href: '/inventory', label: 'Inventory', icon: 'inventory', permission: 'inventory:read' },
      { href: '/sales', label: 'Sales & fulfilment', icon: 'sales', permission: 'inventory:read' },
      { href: '/deliveries', label: 'Deliveries', icon: 'truck', permission: 'inventory:read' },
      { href: '/suppliers', label: 'Suppliers', icon: 'supplier', permission: 'inventory:read' },
      { href: '/tasks', label: 'Tasks', icon: 'tasks', permission: 'inventory:read' },
      { href: '/volunteers', label: 'Volunteers', icon: 'volunteers', permission: 'volunteers:read' },
    ],
  },
  {
    section: 'Products',
    items: [
      { href: '/website', label: 'Website & Shop', icon: 'website', permission: 'website:read' },
      { href: '/design-agent', label: 'WhatsApp agent', icon: 'agent', permission: 'design_agent:read' },
      { href: '/furniture', label: 'Furniture collection', icon: 'furniture', permission: 'furniture:read' },
      { href: '/map', label: 'Interactive map', icon: 'map', permission: 'map:read' },
      { href: '/gift-cards', label: 'Gift cards', icon: 'gift', permission: 'gift_cards:read' },
    ],
  },
  {
    section: 'Intelligence',
    items: [
      { href: '/analytics', label: 'Analytics', icon: 'analytics' },
      { href: '/reports', label: 'Reports', icon: 'report' },
      { href: '/assistant', label: 'AI assistant', icon: 'assistant', permission: 'assistant:use' },
      { href: '/notifications', label: 'Notifications', icon: 'bell' },
    ],
  },
  {
    section: 'System',
    items: [
      { href: '/integrations', label: 'Integrations', icon: 'plug', permission: 'integrations:read' },
      { href: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]
