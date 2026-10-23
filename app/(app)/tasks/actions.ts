'use server'

import { z } from 'zod'
import { userCan } from '@/lib/auth/session'
import type { Permission } from '@/lib/auth/rbac'
import { getOpsStore } from '@/lib/ops'
import { runAct, formStr as str, formDate, type ActionState } from '@/lib/ops/act'
import { TASK_ENTITIES, type TaskEntity } from '@/lib/ops/types'
import { AUTOMATION_RULES } from '@/lib/tasks/rules'

const uuid = z.string().uuid()

/** Tasks belong to both modules: the customer side (crm:operate) and the warehouse side (inventory:operate). Either may work them. */
async function taskPerm(): Promise<Permission> {
  return (await userCan('crm:operate')) ? 'crm:operate' : 'inventory:operate'
}

export async function createTaskAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const title = str(f, 'title', 200)
  if (!title) return { ok: false, message: 'Say what needs doing.' }
  const due = formDate(f, 'due')
  if (due === 'invalid') return { ok: false, message: 'Pick a valid due date.' }
  const kind = String(f.get('entityKind') ?? '')
  const entityKind = (TASK_ENTITIES as readonly string[]).includes(kind) ? (kind as TaskEntity) : null
  const rawId = String(f.get('entityId') ?? '').trim().slice(0, 100)
  const entityId = entityKind && (entityKind === 'website_order' ? /^\d+$/.test(rawId) : uuid.safeParse(rawId).success) ? rawId : null
  return runAct('crm', [await taskPerm()], 'task.create', entityKind && entityId ? `${entityKind}:${entityId}` : 'task:new', { title, due }, async (u) => {
    await getOpsStore().createTask({ title, detail: str(f, 'detail', 2000), dueAt: due, entityKind: entityId ? entityKind : null, entityId, assigneeProfileId: f.get('mine') === 'on' ? u.id : null, source: 'manual', createdBy: u.email })
    return { ok: true, message: 'Task added.' }
  }, ['/tasks', '/', ...(entityKind === 'item' && entityId ? [`/inventory/${entityId}`] : entityKind === 'contact' && entityId ? [`/crm/${entityId}`] : [])])
}

export async function setTaskStatusAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = uuid.safeParse(f.get('id'))
  const status = z.enum(['open', 'done', 'cancelled']).safeParse(f.get('status'))
  if (!id.success || !status.success) return { ok: false, message: 'Invalid request.' }
  return runAct('crm', [await taskPerm()], `task.${status.data === 'open' ? 'reopen' : status.data}`, `task:${id.data}`, {}, async (u) => {
    const t = await getOpsStore().setTaskStatus(id.data, status.data, u.email)
    return t ? { ok: true, message: status.data === 'done' ? 'Done.' : status.data === 'open' ? 'Reopened.' : 'Cancelled.' } : { ok: false, message: 'That task no longer exists.' }
  }, ['/tasks', '/'])
}

/** Switching an automation changes what the system does by itself for everyone: owner/admin level (crm:write + inventory:write). */
export async function setRuleAction(_p: ActionState, f: FormData): Promise<ActionState> {
  const id = String(f.get('id') ?? '')
  if (!AUTOMATION_RULES.some((r) => r.id === id)) return { ok: false, message: 'Unknown automation.' }
  const enabled = f.get('enabled') === 'true'
  return runAct('crm', ['crm:write', 'inventory:write'], 'automation.set', `rule:${id}`, { enabled }, async (u) => {
    await getOpsStore().setRule(id, enabled, u.email)
    return { ok: true, message: enabled ? 'Switched on.' : 'Switched off.' }
  }, ['/tasks', '/'])
}
