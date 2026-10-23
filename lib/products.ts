import type { Product } from '@/lib/auth/rbac'

/** Where each product lives in the console, and its name. One list, so a new module cannot be missing from one screen. */
export const PRODUCT_HREF: Record<Product, string> = {
  website: '/website',
  gift_cards: '/gift-cards',
  furniture: '/furniture',
  design_agent: '/design-agent',
  map: '/map',
  crm: '/crm',
  inventory: '/inventory',
}

export const PRODUCT_LABEL: Record<Product, string> = {
  website: 'Website & shop',
  gift_cards: 'Gift cards',
  furniture: 'Furniture',
  design_agent: 'Design agent',
  map: 'Map',
  crm: 'Customers (CRM)',
  inventory: 'Inventory & sales',
}
