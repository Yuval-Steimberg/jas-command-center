import type { Contact, ContactRole, DealStage } from '../ops/types'

/**
 * Contact identity, pure. One person = one contact, recognised by email or
 * phone. Emails are compared lower-case and trimmed; Israeli phone numbers in
 * any common shape (+972 50-123-4567, 0501234567, 972501234567) become
 * 0501234567, so a website order and a form message from the same person meet.
 */
export function normalizeEmail(v: string | null | undefined): string | null {
  const e = v?.trim().toLowerCase()
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null
}

export function normalizePhone(v: string | null | undefined): string | null {
  if (!v) return null
  let d = v.replace(/\D/g, '')
  if (d.startsWith('00972')) d = d.slice(5)
  else if (d.startsWith('972')) d = d.slice(3)
  if (d.length === 9 && !d.startsWith('0')) d = `0${d}`
  return d.length >= 9 && d.length <= 10 ? d : null
}

/** Israeli mobile → wa.me link (international form). Null for anything that is not a mobile. */
export function whatsappLink(phone: string | null): string | null {
  const p = normalizePhone(phone)
  return p && /^05\d{8}$/.test(p) ? `https://wa.me/972${p.slice(1)}` : null
}

export const ROLE_LABEL: Record<ContactRole, string> = { customer: 'Customer', lead: 'Lead', supplier: 'Supplier', partner: 'Partner', donor: 'Donor', volunteer: 'Volunteer', refurbisher: 'Refurbisher' }
export const STAGE_LABEL: Record<DealStage, string> = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal', won: 'Won', lost: 'Lost' }
export const OPEN_STAGES: readonly DealStage[] = ['new', 'contacted', 'qualified', 'proposal']

export const withRole = (roles: readonly ContactRole[], role: ContactRole): ContactRole[] => (roles.includes(role) ? [...roles] : [...roles, role])

/** What to change on an existing contact when a source names them again: fill blanks, add the role, never overwrite. */
export function mergeContact(c: Pick<Contact, 'fullName' | 'email' | 'phone' | 'roles'>, seen: { name?: string | null; email: string | null; phone: string | null; role: ContactRole }) {
  const patch: Partial<Pick<Contact, 'fullName' | 'email' | 'phone' | 'roles'>> = {}
  if (!c.email && seen.email) patch.email = seen.email
  if (!c.phone && seen.phone) patch.phone = seen.phone
  if (!c.fullName.trim() && seen.name?.trim()) patch.fullName = seen.name.trim()
  if (!c.roles.includes(seen.role)) patch.roles = withRole(c.roles, seen.role)
  return patch
}

/** Days since the lead was last contacted (or created); used by the "not contacted" alert and the assistant. */
export function daysWithoutContact(d: { lastContactedAt: string | null; createdAt: string }, now = Date.now()) {
  return Math.floor((now - Date.parse(d.lastContactedAt ?? d.createdAt)) / 86_400_000)
}

export const CHANNEL_LABEL: Record<import('../ops/types').Channel, string> = {
  whatsapp: 'WhatsApp', phone: 'Phone call', email: 'Email', in_person: 'In person', website_form: 'Website form', website_order: 'Website order', gift_card: 'Gift card', note: 'Note',
}
