'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CreditCard } from 'lucide-react'
import { ActionForm, Field } from '@/app/(app)/inventory/forms'
import { terminalCancelAction, terminalChargeAction } from '@/app/(app)/sales/actions'
import { input } from '@/app/(app)/website/forms'
import type { SaleCopy } from './copy'
import { closeTerminalTab, sendTerminalTab } from './terminal-tab'

/** Grow: on the GROW Android app a physical card tap is capped at ₪300; digital wallets are not. */
const TAP_CAP = 30000

export interface TerminalChargeState {
  id: string
  status: 'sent' | 'paid' | 'failed' | 'cancelled'
  url: string | null
  amount: string
  /** Agorot, for the GROW app's card-tap cap. */
  cents: number
  device: string
  fresh: boolean
  error: string | null
  approveError: string | null
}

/**
 * Push the balance to the shop's Grow terminal. The link Grow returns does the
 * push when opened; the page then polls until Grow's server update has
 * recorded the payment (or the seller stops waiting).
 */
export function TerminalCharge({ saleId, t, amount, devices, last, requestId }: {
  saleId: string
  t: SaleCopy
  amount: number | null
  devices: string[]
  last: TerminalChargeState | null
  requestId: string
}) {
  const router = useRouter()
  const waiting = last?.status === 'sent' && last.fresh && Boolean(last.url)
  // Checkout opened a tab on the seller's tap; hand it Grow's link, which pushes the amount to the terminal.
  const [autoSent, setAutoSent] = useState<string | null>(null)
  useEffect(() => {
    if (waiting && last?.url && autoSent !== last.id && sendTerminalTab(last.url)) setAutoSent(last.id)
    // Grow refused the push: the tab checkout opened for it has nothing to show.
    if (last?.status === 'failed') closeTerminalTab()
  }, [waiting, last?.id, last?.url, last?.status, autoSent])
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(timer)
  }, [waiting, router])

  if (last?.status === 'sent' && last.url) {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-line bg-ground/40 p-2 text-sm">
        <p className="font-medium text-ink">{last.fresh ? t.terminalWaiting : t.terminalNoAnswer} <span className="num" dir="ltr">{last.amount}</span> · <span dir="auto">{last.device}</span></p>
        <p className="text-meta text-muted">{autoSent === last.id ? t.terminalSentAuto : t.terminalSteps}</p>
        {last.cents > TAP_CAP ? <p className="text-meta text-warn">{t.terminalTapCap}</p> : null}
        <a href={last.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-forest px-4 font-semibold text-cream hover:bg-forest/90">
          <CreditCard aria-hidden className="h-4 w-4" />{t.terminalSend}
        </a>
        <ActionForm action={terminalCancelAction} hidden={{ chargeId: last.id }} label={t.terminalCancel} busy={t.saving} confirm={t.terminalCancelConfirm} />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 text-sm">
      {last?.status === 'failed' && last.error ? <p dir="auto" className="text-bad">{t.terminalFailed}: {last.error}</p> : null}
      {last?.status === 'paid' && last.approveError ? <p dir="auto" className="text-warn">{t.terminalApproveFailed}: {last.approveError}</p> : null}
      {amount ? (
        <ActionForm action={terminalChargeAction} hidden={{ saleId, requestId }} label={t.terminalCharge} busy={t.saving} tone="primary" className="grid gap-2 sm:grid-cols-2">
          <Field label={t.amount} hint={amount > TAP_CAP ? t.terminalTapCap : undefined}><input name="amount" required inputMode="decimal" dir="ltr" defaultValue={String(amount / 100)} className={input} /></Field>
          {devices.length > 1 ? (
            <Field label={t.terminalDevice}>
              <select name="device" defaultValue={devices[0]} className={input}>{devices.map((d) => <option key={d} value={d}>{d}</option>)}</select>
            </Field>
          ) : <input type="hidden" name="device" value={devices[0] ?? ''} />}
        </ActionForm>
      ) : null}
    </div>
  )
}
