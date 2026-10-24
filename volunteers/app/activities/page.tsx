import type { Metadata } from 'next'
import { SlidersHorizontal } from 'lucide-react'
import { AREAS, AREA_HE, KINDS, KIND_HE, PARTS, PART_HE, SKILLS, SKILL_HE, type Area, type ActivityKind, type DayPart, type Skill } from '@shared/volunteers/model'
import { loadUpcoming } from '@shared/volunteers/views'
import { addDays, israelDay, israelWeekday, slotOf } from '@shared/volunteers/time'
import { getStore } from '@/lib/store'
import { load } from '@/lib/load'
import { ActivityCard, byActivity } from '@/components/shift'
import { Empty, Notice, Page, Title, input, secondaryBtn } from '@/components/ui'
import Link from 'next/link'

export const metadata: Metadata = { title: 'פעילויות פתוחות' }

const WHEN = { all: 'כל התאריכים', week: 'השבוע הקרוב', weekend: 'סוף השבוע', next14: 'בשבועיים הקרובים' } as const
type When = keyof typeof WHEN

const one = <T extends string>(all: readonly T[], v: unknown): T | null => (typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : null)

export default async function Activities({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const when = (one(Object.keys(WHEN) as When[], searchParams.when) ?? 'all') as When
  const area = one<Area>(AREAS, searchParams.area)
  const kind = one<ActivityKind>(KINDS, searchParams.kind)
  const part = one<DayPart>(PARTS, searchParams.time)
  const skill = one<Skill>(SKILLS, searchParams.skill)
  const all = searchParams.full === '1'
  const res = await load(() => loadUpcoming(getStore()))
  const filtered = Boolean(searchParams.when || area || kind || part || skill || all)

  return (
    <Page>
      <Title sub="בוחרים פעילות, ואז משמרת. אפשר לראות הכול גם בלי להירשם.">פעילויות פתוחות</Title>
      {searchParams.welcome === '1' ? <div className="mb-4"><Notice tone="ok">ברוך/ה הבא/ה. שלחנו אימייל עם הפרטים. עכשיו אפשר לבחור משמרת.</Notice></div> : null}
      <details className="group mb-4 rounded-lg border border-line bg-paper shadow-1" open={filtered}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 font-semibold text-forest">
          <span className="inline-flex items-center gap-2"><SlidersHorizontal aria-hidden className="h-5 w-5" strokeWidth={1.75} />סינון</span>
          {filtered ? <span className="text-sm font-normal text-slate">מסונן</span> : null}
        </summary>
        <form className="grid gap-3 border-t border-line p-4 sm:grid-cols-2" method="get">
          <Select name="when" label="מתי" value={when} options={Object.entries(WHEN).map(([value, label]) => ({ value, label }))} />
          <Select name="time" label="שעה ביום" value={part ?? ''} options={[{ value: '', label: 'כל היום' }, ...PARTS.map((p) => ({ value: p, label: PART_HE[p] }))]} />
          <Select name="area" label="אזור" value={area ?? ''} options={[{ value: '', label: 'כל האזורים' }, ...AREAS.map((a) => ({ value: a, label: AREA_HE[a] }))]} />
          <Select name="kind" label="סוג פעילות" value={kind ?? ''} options={[{ value: '', label: 'כל הסוגים' }, ...KINDS.map((k) => ({ value: k, label: KIND_HE[k] }))]} />
          <Select name="skill" label="כישורים" value={skill ?? ''} options={[{ value: '', label: 'לא משנה' }, ...SKILLS.map((s) => ({ value: s, label: SKILL_HE[s] }))]} />
          <label className="flex min-h-12 items-center gap-3 self-end text-base"><input type="checkbox" name="full" value="1" defaultChecked={all} className="h-5 w-5 accent-[rgb(51,61,54)]" />להציג גם משמרות מלאות</label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={`${secondaryBtn} flex-1 bg-forest text-ground hover:bg-forest/90`}>הצגת תוצאות</button>
            {filtered ? <Link href="/activities" className={secondaryBtn}>ניקוי</Link> : null}
          </div>
        </form>
      </details>

      {!res.ok ? <Notice tone="bad">{res.message}</Notice> : (() => {
        const today = israelDay()
        const inWhen = (iso: string) => {
          const d = israelDay(iso)
          if (when === 'week') return d <= addDays(today, 6)
          if (when === 'next14') return d <= addDays(today, 13)
          if (when === 'weekend') { const w = israelWeekday(iso); return d <= addDays(today, 7) && (w === 'fri' || w === 'sat') }
          return true
        }
        const views = res.data.views.filter(
          (v) =>
            (v.phase === 'open' || (all && v.phase === 'full')) && inWhen(v.shift.startsAt) && (!area || v.activity.area === area) && (!kind || v.activity.kind === kind) &&
            (!part || slotOf(v.shift.startsAt).endsWith(`_${part}`)) && (!skill || v.activity.requiredSkills.includes(skill) || (skill === 'driving' && v.activity.kind === 'transport') || (skill === 'lifting' && ['collection', 'loading'].includes(v.activity.kind))),
        )
        const groups = byActivity(views)
        if (!groups.length)
          return <Empty title={filtered ? 'אין פעילויות שמתאימות לסינון' : 'אין כרגע פעילויות פתוחות'} href={filtered ? '/activities' : undefined} cta={filtered ? 'להציג הכול' : undefined}>{filtered ? 'אפשר להרחיב את הסינון או לנסות תאריכים אחרים.' : 'פעילויות חדשות נפתחות כל הזמן. כדאי לחזור בקרוב.'}</Empty>
        return (
          <>
            <p className="mb-3 text-sm text-slate" aria-live="polite">{groups.length === 1 ? 'פעילות אחת' : `${groups.length} פעילויות`}</p>
            <div className="grid gap-3">{groups.map((g) => <ActivityCard key={g[0]!.activity.id} views={g} href={`/activities/${g[0]!.activity.id}`} />)}</div>
          </>
        )
      })()}
    </Page>
  )
}

function Select({ name, label, value, options }: { name: string; label: string; value: string; options: { value: string; label: string }[] }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-forest">{label}</span>
      <select name={name} defaultValue={value} className={input}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  )
}
