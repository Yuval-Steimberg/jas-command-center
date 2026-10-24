'use client'

import { useFormState } from 'react-dom'
import { loginAction, type LoginState } from './actions'
import { Submit } from '@/components/submit'
import { Notice, input, primaryBtn, quietBtn } from '@/components/ui'

export function LoginForm({ next }: { next: string }) {
  const [state, run] = useFormState(loginAction, { step: 'email', next } as LoginState)
  return (
    <form action={run} className="grid gap-4" noValidate>
      <input type="hidden" name="next" value={state.next ?? next} />
      {state.step === 'email' ? (
        <>
          <label className="block">
            <span className="mb-1.5 block text-base font-semibold text-forest">אימייל</span>
            <input name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" required defaultValue={state.email} placeholder="name@example.com" className={`${input} text-left`} autoFocus />
          </label>
          <Submit className={primaryBtn} busy="שולחים קוד…">לקבלת קוד כניסה</Submit>
          <p className="text-center text-sm text-slate">נשלח אלייך קוד חד-פעמי. אין סיסמה לזכור.</p>
        </>
      ) : (
        <>
          <label className="block">
            <span className="mb-1.5 block text-base font-semibold text-forest">הקוד שקיבלת</span>
            <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} required dir="ltr" placeholder="••••••" className={`${input} text-center text-2xl tracking-[0.5em]`} autoFocus />
          </label>
          {state.devCode ? <Notice>סביבת פיתוח: אין שליחת אימייל, והקוד הוא <span className="ltr font-bold">{state.devCode}</span></Notice> : null}
          <Submit className={primaryBtn} busy="בודקים…">כניסה</Submit>
          <div className="flex justify-between">
            <button type="submit" name="intent" value="resend" className={quietBtn} formNoValidate>שליחת קוד חדש</button>
            <button type="submit" name="intent" value="restart" className={quietBtn} formNoValidate>כתובת אחרת</button>
          </div>
        </>
      )}
      <div aria-live="polite" className="empty:hidden">{state.message ? <Notice tone={state.ok ? 'ok' : 'bad'}>{state.message}</Notice> : null}</div>
    </form>
  )
}
