import Link from 'next/link'
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui/card'
import { Kpi } from '@/components/ui/kpi'
import { OpsUnavailable, linkCls } from '@/components/ops/ui'
import { getSession, requireUser } from '@/lib/auth/session'
import { can } from '@/lib/auth/rbac'
import { redirect } from 'next/navigation'
import { getOpsStore } from '@/lib/ops'
import { loadOps } from '@/lib/ops/guard'
import { TASK_ENTITIES, type Task } from '@/lib/ops/types'
import { AUTOMATION_RULES } from '@/lib/tasks/rules'
import { formatCount, formatDateTime, timeAgo } from '@/lib/format'
import { input } from '../website/forms'
import { ActionForm, Field } from '../inventory/forms'
import { createTaskAction, setRuleAction, setTaskStatusAction } from './actions'

export const dynamic = 'force-dynamic'

const ENTITY_LABEL: Record<string, string> = { item: 'Item', contact: 'Contact', deal: 'Lead', delivery: 'Delivery', website_order: 'Website order' }

function entityHref(t: Pick<Task, 'entityKind' | 'entityId'>): string | null {
  if (!t.entityKind || !t.entityId) return null
  if (t.entityKind === 'item') return `/inventory/${t.entityId}`
  if (t.entityKind === 'contact') return `/crm/${t.entityId}`
  if (t.entityKind === 'deal') return '/crm/pipeline'
  if (t.entityKind === 'delivery') return '/deliveries'
  return '/website/orders'
}

const SOURCE_LABEL: Record<string, string> = {
  manual: 'added by hand',
  'automation:intake_needs_price': 'automation: prepare for sale',
  'automation:sale_needs_delivery': 'automation: arrange delivery',
  'automation:website_form_lead': 'automation: website form',
  'automation:double_sale': 'automation: possible double sale',
}

export default async function TasksPage({ searchParams }: { searchParams?: { entity?: string; id?: string; view?: string } }) {
  await requireUser()
  const s = (await getSession())!
  const may = (p: Parameters<typeof can>[1]) => can(s.user.role, p, s.overrides)
  if (!may('crm:read') && !may('inventory:read')) redirect('/forbidden')
  const canWork = may('crm:operate') || may('inventory:operate')
  const pii = may('crm:read_pii')
  const prefillKind = TASK_ENTITIES.find((k) => k === searchParams?.entity) ?? ''
  const prefillId = prefillKind && typeof searchParams?.id === 'string' ? searchParams.id.slice(0, 100) : ''
  const mine = searchParams?.view === 'mine'

  const res = await loadOps(async () => {
    const store = getOpsStore()
    const [open, done, rules] = await Promise.all([store.listTasks({ status: 'open', limit: 500 }), store.listTasks({ status: 'done', limit: 30 }), store.ruleSettings()])
    return { open: mine ? open.filter((t) => t.assigneeProfileId === s.user.id) : open, done: done.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')), rules }
  })
  const now = Date.now()
  const overdue = res.ok ? res.data.open.filter((t) => t.dueAt && Date.parse(t.dueAt) < now) : []

  return (
    <>
      <PageHeader
        title="Tasks & automations"
        description="Follow-ups for people and items. Automations below open tasks by themselves (one per event, never twice); an overdue task shows on the attention list. Tasks about customers hide their details from roles without access to personal data."
        actions={
          <div className="flex gap-3 text-sm">
            <Link href="/tasks" className={linkCls} aria-current={!mine ? 'page' : undefined}>All open</Link>
            <Link href="/tasks?view=mine" className={linkCls} aria-current={mine ? 'page' : undefined}>Assigned to me</Link>
          </div>
        }
      />
      {!res.ok ? <OpsUnavailable message={res.message} /> : (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Kpi label="Open" value={formatCount(res.data.open.length)} />
              <Kpi label="Overdue" value={formatCount(overdue.length)} tone={overdue.length ? 'warn' : undefined} />
              <Kpi label="Possible double sales" value={formatCount(res.data.open.filter((t) => t.source === 'automation:double_sale').length)} tone={res.data.open.some((t) => t.source === 'automation:double_sale') ? 'bad' : undefined} />
            </div>
            <Card>
              <CardHeader title="Open tasks" meta="soonest due first" />
              <CardBody>
                {res.data.open.length === 0 ? <p className="text-sm text-muted">Nothing open.</p> : (
                  <ul className="flex flex-col divide-y divide-line/60">
                    {res.data.open.map((t) => {
                      const late = t.dueAt && Date.parse(t.dueAt) < now
                      const href = entityHref(t)
                      const sensitive = (t.entityKind === 'contact' || t.entityKind === 'deal') && !pii
                      return (
                        <li key={t.id} id={`t-${t.id}`} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
                          <div className="min-w-0 flex-1 text-sm">
                            <p dir="auto" className={`font-medium ${t.source === 'automation:double_sale' ? 'text-bad' : 'text-ink'}`}>{sensitive ? `Follow up a ${ENTITY_LABEL[t.entityKind!]?.toLowerCase()}` : t.title}</p>
                            {t.detail && !sensitive ? <p dir="auto" className="mt-0.5 whitespace-pre-line text-muted">{t.detail}</p> : null}
                            <p className="mt-1 text-xs text-muted">
                              {t.dueAt ? <span className={late ? 'font-medium text-warn' : ''}>due {formatDateTime(t.dueAt)}{late ? ' (overdue)' : ''}</span> : 'no due date'}
                              {' · '}{SOURCE_LABEL[t.source] ?? t.source}
                              {t.assigneeProfileId === s.user.id ? ' · yours' : ''}
                              {href ? <> · <Link href={href} className={linkCls}>{ENTITY_LABEL[t.entityKind!]}</Link></> : null}
                            </p>
                          </div>
                          {canWork ? (
                            <div className="flex gap-2">
                              <ActionForm action={setTaskStatusAction} hidden={{ id: t.id, status: 'done' }} label="Done" busy="…" className="flex flex-col gap-1" />
                              <ActionForm action={setTaskStatusAction} hidden={{ id: t.id, status: 'cancelled' }} label="Drop" busy="…" confirm="Drop this task without doing it?" className="flex flex-col gap-1" />
                            </div>
                          ) : null}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Done recently" />
              <CardBody>
                {res.data.done.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
                  <ul className="flex flex-col gap-2 text-sm">
                    {res.data.done.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center gap-x-2">
                        <span dir="auto" className="text-muted line-through">{(t.entityKind === 'contact' || t.entityKind === 'deal') && !pii ? 'Follow-up' : t.title}</span>
                        <span className="text-xs text-faint">{t.completedBy} · {timeAgo(t.completedAt)}</span>
                        {canWork ? <ActionForm action={setTaskStatusAction} hidden={{ id: t.id, status: 'open' }} label="Reopen" busy="…" className="flex items-center gap-2" /> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {canWork ? (
              <Card>
                <CardHeader title="Add a task" />
                <CardBody>
                  <ActionForm action={createTaskAction} hidden={{ entityKind: prefillKind, entityId: prefillId }} label="Add task" busy="Saving…" tone="primary">
                    <Field label="What"><input name="title" required dir="auto" maxLength={200} className={input} /></Field>
                    <Field label="Details"><textarea name="detail" dir="auto" maxLength={2000} rows={3} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm" /></Field>
                    <Field label="Due"><input name="due" type="date" dir="ltr" className={input} /></Field>
                    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="mine" className="h-4 w-4" /> Assign to me</label>
                    {prefillKind && prefillId ? <p className="text-xs text-muted">Linked to this {ENTITY_LABEL[prefillKind]?.toLowerCase()}.</p> : null}
                  </ActionForm>
                </CardBody>
              </Card>
            ) : null}
            <Card>
              <CardHeader title="Automations" meta="what the system does by itself" />
              <CardBody>
                <ul className="flex flex-col gap-3">
                  {AUTOMATION_RULES.map((r) => {
                    const on = res.data.rules.get(r.id) ?? true
                    return (
                      <li key={r.id} className="text-sm">
                        <p className="font-medium text-ink">{r.label}</p>
                        <p className="text-xs text-muted">{r.detail} · {r.kind === 'task' ? 'opens a task' : r.kind === 'alert' ? 'raises an alert' : 'changes records'} · <span className={on ? 'text-ok' : 'text-muted'}>{on ? 'on' : 'off'}</span></p>
                        {may('crm:write') && may('inventory:write') ? (
                          <ActionForm action={setRuleAction} hidden={{ id: r.id, enabled: on ? 'false' : 'true' }} label={on ? 'Switch off' : 'Switch on'} busy="…" confirm={on ? `Switch off "${r.label}"? The system stops doing this by itself.` : undefined} className="mt-1 flex flex-col gap-1" />
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
