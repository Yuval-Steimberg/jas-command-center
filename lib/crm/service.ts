import 'server-only'
import { getOpsStore, ConflictError } from '@/lib/ops'
import type { Contact, ContactRole, InteractionInput } from '@/lib/ops/types'
import { mergeContact, normalizeEmail, normalizePhone, OPEN_STAGES, withRole } from './model'

/**
 * Contacts are recognised by email or phone (normalised). A source that names
 * a person again only fills blanks and adds a role; it never overwrites what
 * someone typed here.
 */
export async function upsertContact(seen: { name: string | null; email: string | null; phone: string | null; role: ContactRole; source: string }): Promise<{ contact: Contact; created: boolean } | null> {
  const store = getOpsStore()
  const email = normalizeEmail(seen.email)
  const phone = normalizePhone(seen.phone)
  if (!email && !phone) return null
  const existing = await store.findContact(email, phone)
  if (existing) {
    const patch = mergeContact(existing, { name: seen.name, email, phone, role: seen.role })
    // The phone or email may belong to a different contact already: then leave this one as it is.
    if (patch.phone && (await store.findContact(null, patch.phone))) delete patch.phone
    if (patch.email && (await store.findContact(patch.email, null))) delete patch.email
    return { contact: Object.keys(patch).length ? await store.updateContact(existing.id, patch) : existing, created: false }
  }
  try {
    const contact = await store.createContact({ fullName: seen.name?.trim() || email || phone || 'Unknown', email, phone, roles: [seen.role], source: seen.source })
    return { contact, created: true }
  } catch (e) {
    // Created by a concurrent sync between our lookup and insert: use that one.
    if (e instanceof ConflictError) {
      const again = await store.findContact(email, phone)
      if (again) return { contact: again, created: false }
    }
    throw e
  }
}

/** Add a timeline entry (idempotent when it carries a ref) and optionally a role. */
export async function touchContact(contactId: string, entry: Omit<InteractionInput, 'contactId' | 'actorEmail'>, actorEmail: string, role?: ContactRole) {
  const store = getOpsStore()
  const r = await store.addInteraction({ ...entry, contactId, actorEmail })
  if (role) {
    const c = await store.getContact(contactId)
    if (c && !c.roles.includes(role)) await store.updateContact(contactId, { roles: withRole(c.roles, role) })
  }
  return r
}

/**
 * A person logged a call, chat or visit. Any contact counts as "contacted" for
 * the stale-lead alert; a lead still in "new" moves to "contacted" only when we
 * reached out (an incoming message alone does not answer the lead).
 * Returns how many leads moved.
 */
export async function logInteraction(contactId: string, entry: Pick<InteractionInput, 'channel' | 'direction' | 'summary'>, actorEmail: string): Promise<number> {
  const store = getOpsStore()
  await store.addInteraction({ ...entry, contactId, actorEmail, refKind: null, refId: null })
  let moved = 0
  if (entry.direction === 'in') return 0
  const now = new Date().toISOString()
  for (const d of await store.listDeals({ contactId, stages: OPEN_STAGES })) {
    const toContacted = d.stage === 'new'
    await store.updateDeal(d.id, { lastContactedAt: now, ...(toContacted ? { stage: 'contacted' as const } : {}) })
    if (toContacted) moved++
  }
  return moved
}
