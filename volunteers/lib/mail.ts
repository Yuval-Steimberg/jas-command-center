import 'server-only'
import { deliverOutbox, sendgridSender, type NotifyContext, type Sender } from '@shared/volunteers/notify'
import type { NewOutbox } from '@shared/volunteers/store'
import { env } from './env'
import { getStore } from './store'

export function sender(): Sender | null {
  const e = env()
  return sendgridSender({ apiKey: e.sendgridKey, from: e.emailFrom, replyTo: e.replyTo })
}

export function notifyContext(): NotifyContext {
  const e = env()
  return { appUrl: e.appUrl ?? null, teamPhone: e.teamPhone ?? null }
}

/**
 * Queue messages and try to send what is due straight away. A failure here
 * never fails the volunteer's action: the row stays in the outbox and the
 * hourly job retries it.
 */
export async function notify(rows: (NewOutbox | null)[]) {
  const list = rows.filter((r): r is NewOutbox => r !== null)
  if (!list.length) return
  try {
    const store = getStore()
    await store.enqueue(list)
    await deliverOutbox(store, sender(), 20)
  } catch (e) {
    console.error('volunteer notification failed (left in the outbox):', e instanceof Error ? e.message : e)
  }
}
