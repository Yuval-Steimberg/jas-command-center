import { AREAS, AREA_HE, DAYS, DAY_HE, PARTS, PART_HE, SKILLS, SKILL_HE, TRANSPORT, TRANSPORT_HE, type Volunteer } from '@shared/volunteers/model'
import { Chips, input } from './ui'

/** The optional preferences, shared by registration and the profile page. */
export function PreferenceFields({ v }: { v?: Pick<Volunteer, 'areas' | 'availability' | 'skills' | 'transport' | 'about'> }) {
  return (
    <div className="grid gap-6">
      <Chips name="areas" legend="איפה נוח לך להתנדב?" options={AREAS.map((a) => ({ value: a, label: AREA_HE[a] }))} selected={v?.areas ?? []} />
      <fieldset>
        <legend className="mb-2 text-base font-semibold text-forest">מתי בדרך כלל נוח לך?</legend>
        <div className="overflow-hidden rounded-lg border border-line bg-paper">
          <div className="grid grid-cols-[4.5rem_repeat(3,1fr)] border-b border-line bg-cream2 text-center text-sm font-semibold text-slate">
            <span className="py-2" />
            {PARTS.map((p) => <span key={p} className="py-2">{PART_HE[p]}</span>)}
          </div>
          {DAYS.map((d) => (
            <div key={d} className="grid grid-cols-[4.5rem_repeat(3,1fr)] items-center border-b border-line/60 last:border-0">
              <span className="px-3 text-base text-ink">{DAY_HE[d]}</span>
              {PARTS.map((p) => (
                <label key={p} className="flex min-h-12 cursor-pointer items-center justify-center">
                  <input type="checkbox" name="availability" value={`${d}_${p}`} defaultChecked={v?.availability.includes(`${d}_${p}`)} className="peer sr-only" aria-label={`${DAY_HE[d]} ${PART_HE[p]}`} />
                  <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-transparent transition peer-checked:border-forest peer-checked:bg-forest peer-checked:text-ground peer-focus-visible:ring-2 peer-focus-visible:ring-forest/40" aria-hidden>✓</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </fieldset>
      <Chips name="skills" legend="משהו שכדאי שנדע? (לא חובה)" options={SKILLS.map((s) => ({ value: s, label: SKILL_HE[s] }))} selected={v?.skills ?? []} />
      <fieldset>
        <legend className="mb-2 text-base font-semibold text-forest">רכב</legend>
        <div className="grid gap-2">
          {TRANSPORT.map((t) => (
            <label key={t} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-line bg-paper px-4">
              <input type="radio" name="transport" value={t} defaultChecked={(v?.transport ?? 'none') === t} className="h-5 w-5 accent-[rgb(51,61,54)]" />
              <span className="text-base">{TRANSPORT_HE[t]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="mb-1.5 block text-base font-semibold text-forest">עוד משהו? (לא חובה)</span>
        <textarea name="about" rows={3} maxLength={500} defaultValue={v?.about ?? ''} className={`${input} py-3`} placeholder="למשל: מגיע/ה עם חברים, מגבלה שכדאי שנדע עליה" />
      </label>
    </div>
  )
}

export function Toggle({ name, label, hint, defaultChecked, required }: { name: string; label: React.ReactNode; hint?: string; defaultChecked?: boolean; required?: boolean }) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-lg border border-line bg-paper p-4">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} required={required} className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(51,61,54)]" />
      <span><span className="block text-base text-ink">{label}</span>{hint ? <span className="mt-0.5 block text-sm text-slate">{hint}</span> : null}</span>
    </label>
  )
}
