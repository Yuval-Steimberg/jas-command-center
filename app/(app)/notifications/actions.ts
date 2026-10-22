'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/lib/auth/session'
import { notificationStore } from '@/lib/notifications/store'

/**
 * Mark notifications read for the signed-in user only. This is the person's
 * own inbox state, not a change to any business system, so it is not audited
 * (the audit log records actions on sources and on access).
 */
export async function markReadAction(form: FormData): Promise<void> {
  const user = await requireUser()
  const ids = z.array(z.string().uuid()).max(200).safeParse(form.getAll('id'))
  if (!ids.success || !ids.data.length) return
  await notificationStore().markRead(user.id, ids.data, new Date().toISOString())
  revalidatePath('/notifications')
  revalidatePath('/', 'layout')
}
