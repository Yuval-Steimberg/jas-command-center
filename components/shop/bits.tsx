import { Package } from 'lucide-react'
import { PAYMENT_STATE_HE } from '@/components/sales/copy'

/** An item's photo, or a drawn placeholder that still reads as "an item" rather than an empty box. */
export function Thumb({ src, size = 'md' }: { src?: string | null; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-16 w-16' : 'h-12 w-12'
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt="" loading="lazy" className={`${box} shrink-0 rounded-md object-cover`} />
  return (
    <span className={`${box} grid shrink-0 place-items-center rounded-md bg-sunken text-faint`}>
      <Package aria-hidden className={size === 'lg' ? 'h-6 w-6' : 'h-5 w-5'} strokeWidth={1.75} />
    </span>
  )
}

type PayState = keyof typeof PAYMENT_STATE_HE
const PAY_TONE: Record<PayState, string> = {
  paid: 'border-ok/30 bg-ok/10 text-ok',
  nothing_due: 'border-ok/30 bg-ok/10 text-ok',
  deposit: 'border-warn/30 bg-warn/10 text-warn',
  unpaid: 'border-warn/30 bg-warn/10 text-warn',
  overpaid: 'border-bad/30 bg-bad/10 text-bad',
}

/** Payment state as colour AND word, so it survives a washed-out screen and colour blindness. */
export function PayChip({ state }: { state: PayState }) {
  return <span className={`inline-flex shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${PAY_TONE[state]}`}>{PAYMENT_STATE_HE[state]}</span>
}
