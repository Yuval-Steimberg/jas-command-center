'use client'

import Link from 'next/link'
import { useFormState } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { MIN_AGE, SIGNUP_FIELD_HE, SIGNUP_REQUIRED, signupProblems, signupSummary, type SignupField } from '@shared/volunteers/model'
import { PreferenceFields, Toggle } from '@/components/profile-fields'
import { Submit } from '@/components/submit'
import { Field, Notice, Section, inputState, primaryBtn, quietBtn } from '@/components/ui'
import { registerAction, type JoinState } from './actions'

type Errors = Partial<Record<SignupField, string>>

const read = (form: HTMLFormElement) => {
  const f = new FormData(form)
  return { fullName: String(f.get('fullName') ?? ''), phone: String(f.get('phone') ?? ''), age16: f.get('age16') === 'on', consent: f.get('consent') === 'on' }
}

/**
 * Registration. Checks every required field before sending (the server checks
 * again with the same `signupProblems`) and shows each problem under its own
 * field, plus one line by the button naming everything still missing, so a
 * person who pressed "סיום" sees exactly what to fix instead of a dead end.
 */
export function JoinForm({ next }: { next: string }) {
  const [state, run] = useFormState(registerAction, {} as JoinState)
  const [errors, setErrors] = useState<Errors>({})
  const form = useRef<HTMLFormElement>(null)
  const summary = useRef<HTMLDivElement>(null)

  const focus = (k: SignupField) => {
    const el = form.current?.querySelector<HTMLInputElement>(`#${k}`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el?.focus({ preventScroll: true })
  }

  useEffect(() => {
    if (state.fieldErrors) {
      setErrors(state.fieldErrors)
      const first = SIGNUP_REQUIRED.find((k) => state.fieldErrors?.[k])
      if (first) focus(first)
    } else if (state.message) summary.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [state])

  // Once a field has been flagged, re-check it as the person fixes it, so the red goes away the moment it is right.
  const recheck = (k: SignupField) => () => {
    if (!errors[k] || !form.current) return
    const now = signupProblems(read(form.current))
    setErrors((e) => ({ ...e, [k]: now[k] }))
  }

  const onSubmit = (ev: React.FormEvent<HTMLFormElement>) => {
    const found = signupProblems(read(ev.currentTarget))
    setErrors(found)
    const first = SIGNUP_REQUIRED.find((k) => found[k])
    if (first) {
      ev.preventDefault()
      focus(first)
    }
  }

  const missing = SIGNUP_REQUIRED.filter((k) => errors[k])
  const describe = (k: SignupField) => (errors[k] ? `${k}-error` : undefined)

  return (
    <form ref={form} action={run} onSubmit={onSubmit} noValidate>
      <input type="hidden" name="next" value={next} />
      <div className="grid gap-4">
        <Field label="שם מלא" htmlFor="fullName" error={errors.fullName}>
          <input id="fullName" name="fullName" autoComplete="name" maxLength={80} aria-required aria-invalid={errors.fullName ? true : undefined} aria-describedby={describe('fullName')} onChange={recheck('fullName')} className={inputState(errors.fullName)} />
        </Field>
        <Field label="טלפון נייד" htmlFor="phone" error={errors.phone} hint="רק הצוות רואה אותו, למקרה שצריך לתאם ביום הפעילות. מתנדבים אחרים לא רואים אותו.">
          <input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" aria-required aria-invalid={errors.phone ? true : undefined} aria-describedby={describe('phone')} onChange={recheck('phone')} dir="ltr" placeholder="050-123-4567" className={`${inputState(errors.phone)} text-left`} />
        </Field>
        <Toggle name="age16" required label={`אני בן/בת ${MIN_AGE} ומעלה`} error={errors.age16} onChange={recheck('age16')} />
        <Toggle name="adult" label="אני בן/בת 18 ומעלה" hint="חלק מהפעילויות (הרמה, עבודה בבניינים) פתוחות רק מגיל 18." />
        <Toggle name="consent" required defaultChecked label="אני מסכים/ה לקבל אימיילים על המשמרות שאני נרשם/ת אליהן" hint="אישורים, שינויים וביטולים. בלי זה לא נוכל לעדכן אותך." error={errors.consent} onChange={recheck('consent')} />
      </div>
      <Section title="כדי להציע לך פעילויות מתאימות (לא חובה)">
        <PreferenceFields />
      </Section>
      <Section title="התראות">
        <div className="grid gap-3">
          <Toggle name="notifyReminders" defaultChecked label="תזכורת יום לפני משמרת" />
          <Toggle name="notifyOpportunities" label="אימייל כשנפתחת פעילות באזורים שבחרתי" hint="לכל היותר פעם בשלושה ימים." />
          <Toggle name="consentWhatsapp" label="מאשר/ת גם הודעות WhatsApp בעתיד" hint="עדיין לא פעיל. נשמור את ההסכמה לכשנחבר מספר וואטסאפ עסקי." />
        </div>
      </Section>
      <p className="mt-6 text-sm text-slate">אין הודעות בין 21:00 ל-08:00, חוץ מעדכון דחוף על משמרת של אותו יום. <Link href="/privacy" className="underline underline-offset-4">מה אנחנו שומרים ולמה</Link>.</p>
      <div ref={summary} aria-live="polite" className="mt-6 empty:hidden">
        {missing.length ? (
          <Notice tone="bad">
            <p className="font-semibold">{signupSummary(errors)}</p>
            <ul className="mt-1 flex flex-wrap gap-x-1">
              {missing.map((k) => (
                <li key={k}><button type="button" onClick={() => focus(k)} className={`${quietBtn} min-h-11 px-2 text-ink underline`}>{SIGNUP_FIELD_HE[k]}</button></li>
              ))}
            </ul>
          </Notice>
        ) : state.message && !state.fieldErrors ? (
          <Notice tone={state.ok ? 'ok' : 'bad'}>{state.message}</Notice>
        ) : null}
      </div>
      <Submit className={`${primaryBtn} mt-4`} busy="שומרים…">סיום והצטרפות</Submit>
    </form>
  )
}
