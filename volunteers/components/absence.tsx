'use client'

import { useState } from 'react'
import { ActionForm } from './forms'
import { input, quietBtn, secondaryBtn } from './ui'
import { reportAbsenceAction, withdrawAbsenceAction } from '@/app/schedule-actions'

/**
 * Two taps to say "I will not come": the button, then the confirmation (a
 * reason is optional). Nothing else a volunteer can change about the schedule.
 */
export function ReportAbsence({ slotId, date, label }: { slotId: string; date: string; label: string }) {
  const [open, setOpen] = useState(false)
  if (!open) return <button type="button" onClick={() => setOpen(true)} className={`${secondaryBtn} w-full`}>לא אוכל להגיע</button>
  return (
    <ActionForm action={reportAbsenceAction} hidden={{ slotId, date }} submit={`כן, לא אגיע ב${label}`} busy="שולח…" btnClass={`${secondaryBtn} w-full border-warn/40 text-warn`} className="flex flex-col gap-2">
      <label className="text-sm text-slate" htmlFor={`r-${date}`}>סיבה (לא חובה)</label>
      <input id={`r-${date}`} name="reason" maxLength={300} className={input} placeholder="למשל: מחלה, נסיעה" />
      <button type="button" onClick={() => setOpen(false)} className={quietBtn}>ביטול, אני מגיע/ה</button>
    </ActionForm>
  )
}

export function WithdrawAbsence({ absenceId }: { absenceId: string }) {
  return <ActionForm action={withdrawAbsenceAction} hidden={{ absenceId }} submit="בכל זאת אגיע" busy="שולח…" btnClass={`${quietBtn} w-full`} />
}
