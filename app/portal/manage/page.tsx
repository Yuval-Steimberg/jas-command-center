import Link from 'next/link'
import { ArrowDown, ArrowRight, ArrowUp, Eye, History, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { requirePageAccess, getSession } from '@/lib/auth/session'
import { ROLES } from '@/lib/auth/rbac'
import { listAudit } from '@/lib/audit/audit'
import { appUrls, loadPortal } from '@/lib/portal/service'
import { APP_LABEL, AUDIENCES, AUDIENCE_LABEL, PORTAL_ICONS, resolveDestination, type AppUrls, type PortalAction, type PortalCategory } from '@/lib/portal/model'
import { WHO_OPTIONS, roleHe, rolesWith, whoLabel } from '@/lib/portal/who'
import { AudienceTag, CategoryIcon, ICON_LABEL } from '@/components/portal/bits'
import { formatDayTime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { deleteActionAct, moveActionAct, moveCategoryAct, saveActionAct, saveCategoryAct, toggleActionAct } from './actions'

export const dynamic = 'force-dynamic'

const input = 'h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink focus:border-forest focus:outline-none'
const label = 'flex flex-col gap-1 text-sm text-muted'
const smallBtn = 'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 text-sm text-ink hover:bg-sunken disabled:opacity-40'
const primary = 'inline-flex h-11 items-center justify-center rounded-full bg-forest px-5 text-sm font-bold text-cream hover:bg-forest/90'

/** In words: where a link goes. */
function describe(dest: string, apps: AppUrls): { text: string; path?: string; warn: string | null } {
  const r = resolveDestination(dest, apps)
  if (!dest.trim()) return { text: 'עוד אין כתובת', warn: 'בלי כתובת הקישור לא מופיע בפורטל.' }
  if (dest.startsWith('app:')) {
    const key = dest.slice(4).split('/')[0] as keyof typeof APP_LABEL
    const name = APP_LABEL[key] ?? 'אפליקציה'
    return { text: name, warn: !r.ok && r.reason === 'app_not_configured' ? `הכתובת של ${name} לא מוגדרת במערכת, ולכן הקישור מוסתר.` : null }
  }
  if (!r.ok) return { text: dest, warn: 'הכתובת לא תקינה, ולכן הקישור מוסתר.' }
  return r.external ? { text: new URL(r.href).host, warn: null } : { text: 'מסך במערכת', path: r.href, warn: null }
}

const ACTION_HE: Record<string, string> = {
  'portal.action.add': 'הוספת קישור',
  'portal.action.edit': 'עריכת קישור',
  'portal.action.toggle': 'הפעלה או כיבוי',
  'portal.action.move': 'שינוי סדר',
  'portal.action.delete': 'מחיקת קישור',
  'portal.category.add': 'הוספת קטגוריה',
  'portal.category.edit': 'עריכת קטגוריה',
  'portal.category.move': 'שינוי סדר קטגוריות',
  'portal.chat.ask': 'בקשה בשיחה',
  'portal.dev_request': 'בקשה לפיתוח',
}

/**
 * Spec page 4, "מסך הניהול": add a link and choose its category; set its
 * address, description, who it is for and who sees it; reorder with up/down;
 * preview as each role; switch off before deleting; a history of changes.
 * Nothing technical is asked for that a manager would not know.
 */
export default async function ManagePage({ searchParams }: { searchParams?: { ok?: string; err?: string } }) {
  await requirePageAccess('portal:manage')
  const overrides = (await getSession())?.overrides
  const [{ data, problem }, history] = await Promise.all([loadPortal(), listAudit(40, { product: 'portal' }).catch(() => null)])
  const apps = appUrls()
  const readOnly = problem !== null
  const categories = [...data.categories].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
  const actionsOf = (c: string) => data.actions.filter((a) => a.categoryId === c).sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/portal" className="-ms-2 mb-3 inline-flex h-11 items-center gap-1.5 rounded-full px-2 text-sm text-muted hover:bg-sunken hover:text-ink">
        <ArrowRight aria-hidden className="size-4" />
        חזרה לפורטל
      </Link>
      <h1 className="text-2xl font-extrabold text-ink">ניהול קישורים</h1>
      <p className="mt-1 text-base text-muted">מה מופיע בפורטל, באיזה סדר, ומי רואה כל קישור. כל שינוי נשמר ביומן השינויים למטה.</p>

      {searchParams?.ok ? <p role="status" className="mt-4 rounded-lg border border-ok/30 bg-ok/5 px-4 py-3 text-sm text-ok">{searchParams.ok}</p> : null}
      {searchParams?.err ? <p role="alert" className="mt-4 rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">{searchParams.err}</p> : null}
      {problem ? (
        <div role="alert" className="mt-4 rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
          {problem.kind === 'setup' ? (
            <>אפשר לראות את הקישורים, אבל עוד אי אפשר לשמור שינויים: צריך להריץ פעם אחת את הקובץ <span dir="ltr">supabase/migrations/0014_portal.sql</span> במסד הנתונים של מערכת הניהול.</>
          ) : (
            <>רשימת הקישורים לא נטענה ({problem.message}). מוצגת רשימת ברירת המחדל, ולכן אי אפשר לשמור עכשיו.</>
          )}
        </div>
      ) : null}

      <section aria-labelledby="preview" className="mt-6 rounded-lg border border-line bg-surface p-4">
        <h2 id="preview" className="flex items-center gap-2 text-base font-bold text-ink">
          <Eye aria-hidden className="size-5" />
          תצוגה מקדימה לפי תפקיד
        </h2>
        <p className="mt-1 text-sm text-muted">כך נראה הפורטל למי שיש לו התפקיד הזה. בטלפון ובמחשב.</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {ROLES.filter((r) => r !== 'scheduler').map((r) => (
            <li key={r}>
              <Link href={`/portal?as=${r}`} className="inline-flex h-11 items-center rounded-full bg-sage-soft/70 px-4 text-sm text-forest hover:bg-sage-soft">
                {roleHe(r)}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-6 flex flex-col gap-6">
        {categories.map((c, ci) => (
          <section key={c.id} id={`c-${c.id}`} aria-labelledby={`h-${c.id}`} className={cn('scroll-mt-20 rounded-lg border border-line bg-surface shadow-card', !c.active && 'opacity-80')}>
            <div className="flex flex-wrap items-center gap-3 border-b border-line/70 p-4">
              <CategoryIcon icon={c.icon} />
              <div className="min-w-0 flex-1">
                <h2 id={`h-${c.id}`} className="text-lg font-bold text-ink">
                  {c.title} {!c.active ? <span className="ms-1 rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">כבויה</span> : null}
                </h2>
                <p className="text-sm text-muted">{c.subtitle}</p>
              </div>
              <MoveButtons action={moveCategoryAct} id={c.id} first={ci === 0} last={ci === categories.length - 1} disabled={readOnly} what={c.title} />
            </div>

            <ul className="divide-y divide-line/70">
              {actionsOf(c.id).map((a, ai, list) => {
                const d = describe(a.destination, apps)
                const roles = rolesWith(a.permission, overrides)
                return (
                  <li key={a.id} id={`a-${a.id}`} className={cn('scroll-mt-20 p-4', !a.active && 'bg-sunken/50')}>
                    <div className="flex flex-wrap items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-base font-bold text-ink">{a.title}</span>
                          <AudienceTag audience={a.audience} />
                          {!a.active ? <span className="rounded-full bg-sunken px-2 py-0.5 text-xs font-medium text-muted">כבוי</span> : null}
                        </div>
                        {a.description ? <p className="text-sm text-muted">{a.description}</p> : null}
                        <p className="mt-1 text-sm text-ink">
                          נפתח: <bdi>{d.text}</bdi>
                          {d.path ? <> <bdi dir="ltr" className="text-muted">{d.path}</bdi></> : null}
                        </p>
                        <p className="text-sm text-ink">
                          רואים: {whoLabel(a.permission)} <span className="text-muted">({roles.map(roleHe).join(', ') || 'אף תפקיד'})</span>
                        </p>
                        {d.warn && a.active ? <p className="mt-1 text-sm text-warn">{d.warn}</p> : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <MoveButtons action={moveActionAct} id={a.id} first={ai === 0} last={ai === list.length - 1} disabled={readOnly} what={a.title} />
                        <form action={toggleActionAct}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="expectedUpdatedAt" value={a.updatedAt} />
                          <button className={smallBtn} disabled={readOnly}>
                            <Power aria-hidden className="size-4" />
                            {a.active ? 'כיבוי' : 'הפעלה'}
                          </button>
                        </form>
                      </div>
                    </div>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium text-ink">
                        <span className="inline-flex items-center gap-1.5"><Pencil aria-hidden className="size-4" />עריכה</span>
                      </summary>
                      <ActionForm a={a} categories={categories} disabled={readOnly} />
                    </details>
                    {!a.active ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-sm font-medium text-bad">
                          <span className="inline-flex items-center gap-1.5"><Trash2 aria-hidden className="size-4" />מחיקה</span>
                        </summary>
                        <form action={deleteActionAct} className="mt-2 flex flex-wrap items-center gap-3 rounded-md bg-bad/5 p-3">
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="expectedUpdatedAt" value={a.updatedAt} />
                          <span className="text-sm text-ink">למחוק את &quot;{a.title}&quot; לגמרי? קישורים שכבר נשלחו יפסיקו לעבוד.</span>
                          <button className="inline-flex h-11 items-center rounded-full bg-bad px-4 text-sm font-bold text-cream hover:bg-bad/90" disabled={readOnly}>כן, למחוק</button>
                        </form>
                      </details>
                    ) : null}
                  </li>
                )
              })}
            </ul>

            <div className="flex flex-col gap-2 border-t border-line/70 p-4">
              <details>
                <summary className="cursor-pointer text-sm font-bold text-forest">
                  <span className="inline-flex items-center gap-1.5"><Plus aria-hidden className="size-4" />הוספת קישור ל{c.title}</span>
                </summary>
                <ActionForm categoryId={c.id} categories={categories} disabled={readOnly} />
              </details>
              <details>
                <summary className="cursor-pointer text-sm text-muted">
                  <span className="inline-flex items-center gap-1.5"><Pencil aria-hidden className="size-4" />עריכת הקטגוריה (שם, אייקון, הפעלה)</span>
                </summary>
                <CategoryForm c={c} disabled={readOnly} />
              </details>
            </div>
          </section>
        ))}
      </div>

      <details className="mt-6 rounded-lg border border-dashed border-line bg-surface p-4">
        <summary className="cursor-pointer text-base font-bold text-forest">
          <span className="inline-flex items-center gap-1.5"><Plus aria-hidden className="size-5" />הוספת קטגוריה חדשה</span>
        </summary>
        <CategoryForm disabled={readOnly} />
      </details>

      <section id="history" aria-labelledby="history-h" className="mt-8 scroll-mt-20">
        <h2 id="history-h" className="flex items-center gap-2 text-lg font-bold text-ink">
          <History aria-hidden className="size-5" />
          יומן שינויים
        </h2>
        {history === null ? (
          <p className="mt-2 text-sm text-warn">לא הצלחנו לקרוא את יומן השינויים כרגע.</p>
        ) : history.filter((h) => h.outcome !== 'requested').length === 0 ? (
          <p className="mt-2 text-sm text-muted">עוד לא נעשו שינויים.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line/70 rounded-lg border border-line bg-surface">
            {history
              .filter((h) => h.outcome !== 'requested')
              .map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm">
                  <span className="num text-muted" dir="ltr">{formatDayTime(h.at)}</span>
                  <span className="font-medium text-ink">{ACTION_HE[h.action] ?? h.action}</span>
                  <span className="text-muted" dir="ltr">{h.actorEmail}</span>
                  <span className={cn('basis-full', h.outcome === 'succeeded' ? 'text-ink' : 'text-bad')}>{String(h.detail.message ?? h.detail.error ?? '')}</span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function MoveButtons({ action, id, first, last, disabled, what }: { action: (f: FormData) => Promise<never>; id: string; first: boolean; last: boolean; disabled: boolean; what: string }) {
  return (
    <div className="flex items-center gap-1">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="dir" value="up" />
        <button className={smallBtn} disabled={disabled || first} aria-label={`להזיז למעלה: ${what}`} title="למעלה">
          <ArrowUp aria-hidden className="size-4" />
        </button>
      </form>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="dir" value="down" />
        <button className={smallBtn} disabled={disabled || last} aria-label={`להזיז למטה: ${what}`} title="למטה">
          <ArrowDown aria-hidden className="size-4" />
        </button>
      </form>
    </div>
  )
}

function ActionForm({ a, categoryId, categories, disabled }: { a?: PortalAction; categoryId?: string; categories: PortalCategory[]; disabled: boolean }) {
  const known = WHO_OPTIONS.some((o) => o.permission === (a?.permission ?? null))
  const k = a?.id ?? `new-${categoryId}`
  return (
    <form action={saveActionAct} className="mt-3 grid gap-3 rounded-md bg-sunken/60 p-3 sm:grid-cols-2">
      {a ? <input type="hidden" name="id" value={a.id} /> : null}
      {a ? <input type="hidden" name="expectedUpdatedAt" value={a.updatedAt} /> : null}
      <label className={label}>
        שם הכפתור
        <input name="title" required minLength={2} maxLength={60} defaultValue={a?.title} className={input} />
      </label>
      <label className={label}>
        קטגוריה
        <select name="categoryId" defaultValue={a?.categoryId ?? categoryId} className={input}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </label>
      <label className={cn(label, 'sm:col-span-2')}>
        תיאור קצר: מה קורה כשלוחצים
        <input name="description" maxLength={140} defaultValue={a?.description} className={input} />
      </label>
      <label className={cn(label, 'sm:col-span-2')}>
        כתובת
        <input name="destination" maxLength={500} defaultValue={a?.destination} dir="ltr" className={cn(input, 'text-left')} aria-describedby={`dest-help-${k}`} />
        <span id={`dest-help-${k}`} className="text-xs text-muted">
          כתובת אינטרנט שמתחילה ב-https:// (למשל קבוצת טלגרם או תיקייה בדרייב), או מסך במערכת שמתחיל ב-/ (למשל /shop/sell).
        </span>
      </label>
      <fieldset className={cn(label, 'sm:col-span-2')}>
        <legend className="mb-1">למי הקישור</legend>
        <div className="flex flex-wrap gap-2">
          {AUDIENCES.map((au) => (
            <label key={au} className="inline-flex h-11 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm text-ink">
              <input type="radio" name="audience" value={au} defaultChecked={(a?.audience ?? 'team') === au} />
              {AUDIENCE_LABEL[au]}
            </label>
          ))}
        </div>
        <span className="text-xs text-muted">&quot;לשליחה החוצה&quot; = כתובת ציבורית שאפשר לשלוח ללקוח או למתנדב בלי שיצטרך להיכנס למערכת.</span>
      </fieldset>
      <label className={label}>
        מי רואה את הקישור
        <select name="permission" defaultValue={a?.permission ?? ''} className={input}>
          {!known && a?.permission ? <option value={a.permission}>{a.permission}</option> : null}
          {WHO_OPTIONS.map((o) => (
            <option key={o.permission ?? 'all'} value={o.permission ?? ''}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="inline-flex h-11 items-center gap-2 self-end text-sm text-ink">
        <input type="checkbox" name="active" defaultChecked={a ? a.active : true} className="size-5" />
        פעיל (מופיע בפורטל)
      </label>
      <div className="sm:col-span-2">
        <button className={primary} disabled={disabled}>{a ? 'שמירה' : 'הוספה'}</button>
      </div>
    </form>
  )
}

function CategoryForm({ c, disabled }: { c?: PortalCategory; disabled: boolean }) {
  return (
    <form action={saveCategoryAct} className="mt-3 grid gap-3 rounded-md bg-sunken/60 p-3 sm:grid-cols-2">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      {c ? <input type="hidden" name="expectedUpdatedAt" value={c.updatedAt} /> : null}
      <label className={label}>
        שם הקטגוריה
        <input name="title" required minLength={2} maxLength={40} defaultValue={c?.title} className={input} />
      </label>
      <label className={label}>
        שורה קצרה מתחת לשם
        <input name="subtitle" maxLength={80} defaultValue={c?.subtitle} className={input} />
      </label>
      <label className={label}>
        אייקון
        <select name="icon" defaultValue={c?.icon ?? 'link'} className={input}>
          {PORTAL_ICONS.map((i) => (
            <option key={i} value={i}>{ICON_LABEL[i]}</option>
          ))}
        </select>
      </label>
      <label className="inline-flex h-11 items-center gap-2 self-end text-sm text-ink">
        <input type="checkbox" name="active" defaultChecked={c ? c.active : true} className="size-5" />
        פעילה (מופיעה בפורטל)
      </label>
      <div className="sm:col-span-2">
        <button className={primary} disabled={disabled}>{c ? 'שמירה' : 'הוספת קטגוריה'}</button>
      </div>
    </form>
  )
}
