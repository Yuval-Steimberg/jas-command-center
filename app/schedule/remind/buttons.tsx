'use client'

import { useState, useTransition } from 'react'
import type { ActResult } from '@/lib/schedule/act'
import { logWhatsappReminderAction, sendReminderEmailsAction } from './actions'

/**
 * Two ways to send, both pressed by the scheduler. WhatsApp opens with the text
 * filled in and she picks the group: there is no WhatsApp sending account, so
 * the app records only that it was opened.
 */
export function ReminderButtons({ week, recipients, whatsappUrl, sentBefore, disabled }: { week: string; recipients: number; whatsappUrl: string; sentBefore: boolean; disabled: boolean }) {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<ActResult | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || disabled}
          onClick={() => {
            if (sentBefore && !window.confirm('כבר נשלחה תזכורת לשבוע הזה. לשלוח רק למי שעוד לא קיבל/ה?')) return
            setRes(null)
            start(async () => setRes(await sendReminderEmailsAction({ week }).catch(() => ({ ok: false, message: 'השליחה נכשלה. נא לרענן ולבדוק את היומן למטה.' }))))
          }}
          className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full bg-brand px-5 text-base font-semibold text-forest hover:bg-brand-pressed hover:text-cream disabled:opacity-60"
        >
          {pending ? 'שולח…' : `שליחה במייל (${recipients})`}
        </button>
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={disabled}
          onClick={(e) => {
            if (disabled) { e.preventDefault(); return }
            void logWhatsappReminderAction({ week, recipients }).catch(() => undefined)
          }}
          className="inline-flex min-h-12 flex-1 items-center justify-center rounded-full border border-line bg-surface px-5 text-base font-semibold text-ink hover:bg-sunken aria-disabled:opacity-60"
        >
          שליחה לקבוצת הוואטסאפ
        </a>
      </div>
      {res ? <p role={res.ok ? 'status' : 'alert'} className={`text-sm ${res.ok ? 'text-ok' : 'text-bad'}`}>{res.message}</p> : null}
    </div>
  )
}
