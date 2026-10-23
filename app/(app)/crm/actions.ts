'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getOpsStore } from '@/lib/ops'
import { runAct, formStr as str, formShekels, type ActionState } from '@/lib/ops/act'
import { CHANNELS, CONTACT_ROLES, DEAL_STAGES, type Channel, type ContactRole, type DealStage } from '@/lib/ops/types'
import { normalizeEmail, normalizePhone, OPEN_STAGES } from '@/lib/crm/model'
import { logInteraction } from '@/lib/crm/service'

const uuid = z.string().uuid()

function rolesOf(f: FormData): ContactRole[] {
  return f.getAll('roles').map(String).filter((r): r is ContactRole => (CONTACT_ROLES as readonly string[]).includes(r))
}

/** Create or edit a contact. Email and phone are normalised and must not belong to another contact. */
export async function saveContactAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const fullName = str(f, 'fullName', 200)
  if (!fullName) return { ok: false, message: 'Give the contact a name.' }
  const rawEmail = str(f, 'email', 200)
  const rawPhone = str(f, 'phone', 40)
  const email = normalizeEmail(rawEmail)
  const phone = normalizePhone(rawPhone)
  if (rawEmail && !email) return { ok: false, message: 'That email address is not valid.' }
  if (rawPhone && !phone) return { ok: false, message: 'That phone number is not valid (Israeli numbers, e.g. 050-123-4567).' }
  const kind = f.get('kind') === 'company' ? 'company' : 'person'
  const roles = rolesOf(f)
  let createdId = ''
  const res = await runAct('crm', ['crm:write'], id.success ? 'crm.contact.update' : 'crm.contact.create', `contact:${id.success ? id.data : 'new'}`, { kind, roles }, async () => {
    const store = getOpsStore()
    for (const [e, p] of [[email, null], [null, phone]] as const) {
      if (!e && !p) continue
      const other = await store.findContact(e, p)
      if (other && other.id !== (id.success ? id.data : '')) return { ok: false, message: `${e ? 'This email' : 'This phone'} already belongs to ${other.fullName}. Open that contact instead.` }
    }
    const input = { fullName, kind, email, phone, roles: roles.length ? roles : (['lead'] as ContactRole[]), notes: str(f, 'notes', 2000) } as const
    if (id.success) {
      await store.updateContact(id.data, input)
      return { ok: true, message: 'Saved.' }
    }
    const c = await store.createContact({ ...input, source: 'manual' })
    createdId = c.id
    return { ok: true, message: `Added ${c.fullName}.` }
  }, ['/crm', ...(id.success ? [`/crm/${id.data}`] : [])])
  if (res.ok && createdId) redirect(`/crm/${createdId}`)
  return res
}

/** A call, a WhatsApp chat, a visit: written on the contact's timeline. Logging an outgoing contact moves new leads to "contacted". */
export async function logInteractionAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('contactId'))
  if (!id.success) return { ok: false, message: 'Invalid contact.' }
  const channel = String(f.get('channel') ?? '') as Channel
  if (!(CHANNELS as readonly string[]).includes(channel)) return { ok: false, message: 'Pick how you were in touch.' }
  const direction = f.get('direction') === 'in' ? 'in' : f.get('direction') === 'none' ? 'none' : 'out'
  const summary = str(f, 'summary', 1000)
  if (!summary) return { ok: false, message: 'Write one line about it.' }
  return runAct('crm', ['crm:operate'], 'crm.interaction.log', `contact:${id.data}`, { channel, direction }, async (u) => {
    const moved = await logInteraction(id.data, { channel, direction, summary }, u.email)
    return { ok: true, message: `Logged.${moved ? ` ${moved} new lead(s) moved to "contacted".` : ''}` }
  }, [`/crm/${id.data}`, '/crm', '/crm/pipeline'])
}

export async function createDealAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const contactId = uuid.safeParse(f.get('contactId'))
  if (!contactId.success) return { ok: false, message: 'Invalid contact.' }
  const title = str(f, 'title', 200)
  if (!title) return { ok: false, message: 'Say what the lead is about.' }
  const value = formShekels(f, 'value')
  if (Number.isNaN(value)) return { ok: false, message: 'The value must be an amount in ₪.' }
  const item = uuid.safeParse(f.get('itemId'))
  return runAct('crm', ['crm:write'], 'crm.deal.create', `contact:${contactId.data}`, { title }, async () => {
    await getOpsStore().createDeal({ contactId: contactId.data, title, stage: 'new', valueMinor: value, itemId: item.success ? item.data : null, source: 'manual', nextStep: str(f, 'nextStep', 200) })
    return { ok: true, message: 'Lead added.' }
  }, [`/crm/${contactId.data}`, '/crm/pipeline'])
}

/** Move a lead along. Conditional on the stage the person saw, so two people moving one lead do not overwrite each other silently. */
export async function setDealStageAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const from = String(f.get('from') ?? '') as DealStage
  const to = String(f.get('stage') ?? '') as DealStage
  if (!id.success || !DEAL_STAGES.includes(from) || !DEAL_STAGES.includes(to)) return { ok: false, message: 'Invalid request.' }
  if (from === to) return { ok: true, message: 'No change.' }
  return runAct('crm', ['crm:operate'], 'crm.deal.stage', `deal:${id.data}`, { from, to }, async () => {
    const store = getOpsStore()
    const d = await store.getDeal(id.data)
    if (!d) return { ok: false, message: 'That lead no longer exists.' }
    if (d.stage !== from) return { ok: false, message: `Someone moved it to "${d.stage}" meanwhile. Reload.` }
    const closed = to === 'won' || to === 'lost'
    await store.updateDeal(id.data, { stage: to, closedAt: closed ? new Date().toISOString() : null, ...(OPEN_STAGES.includes(to) && to !== 'new' ? { lastContactedAt: d.lastContactedAt ?? new Date().toISOString() } : {}), nextStep: str(f, 'nextStep', 200) ?? d.nextStep })
    return { ok: true, message: `Moved to ${to}.` }
  }, ['/crm/pipeline', '/crm'])
}
