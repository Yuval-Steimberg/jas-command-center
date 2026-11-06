'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Share2 } from 'lucide-react'
import { cn } from '@/lib/cn'

const absolute = (url: string) => (url.startsWith('/') ? `${window.location.origin}${url}` : url)

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers, or a page without clipboard permission: the textarea route still works.
    const t = document.createElement('textarea')
    t.value = text
    t.setAttribute('readonly', '')
    t.style.position = 'fixed'
    t.style.opacity = '0'
    document.body.appendChild(t)
    t.select()
    const ok = document.execCommand('copy')
    t.remove()
    return ok
  }
}

const btn =
  'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-3 sm:px-3.5 text-sm font-medium text-ink transition-colors duration-150 hover:bg-sunken active:scale-[0.98]'

/**
 * Copy and Share for one link. Share opens the phone's own share sheet
 * (WhatsApp included); where a browser has none it sends to WhatsApp. Every
 * result is said in words (aria-live), so nobody wonders whether it worked.
 */
export function ShareButtons({ url, title, compact = false }: { url: string; title: string; compact?: boolean }) {
  const [done, setDone] = useState<null | 'copied' | 'failed'>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const say = (s: 'copied' | 'failed') => {
    setDone(s)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(null), 2500)
  }

  const onCopy = async () => say((await copyText(absolute(url))) ? 'copied' : 'failed')
  const onShare = async () => {
    const href = absolute(url)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: title, url: href })
      } catch {
        // Closing the share sheet is a choice, not an error.
      }
      return
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(`${title}\n${href}`)}`, '_blank', 'noopener,noreferrer')
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <button type="button" onClick={onCopy} className={cn(btn, done === 'copied' && 'border-forest/40 bg-sage-soft')} aria-label={compact ? `העתקת קישור: ${title}` : undefined}>
        {done === 'copied' ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
        <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>{done === 'copied' ? 'הועתק' : 'העתקה'}</span>
      </button>
      <button type="button" onClick={onShare} className={btn} aria-label={compact ? `שיתוף: ${title}` : undefined}>
        <Share2 aria-hidden className="size-4" />
        <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>שיתוף</span>
      </button>
      <span role="status" aria-live="polite" className="sr-only">
        {done === 'copied' ? 'הקישור הועתק' : done === 'failed' ? 'לא הצלחנו להעתיק. אפשר ללחוץ על שיתוף.' : ''}
      </span>
    </div>
  )
}

/** The home page's one primary action: send someone the portal itself. */
export function SharePortalButton() {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    const href = `${window.location.origin}/portal`
    const title = 'הפורטל של צוות Just A Second'
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: title, url: href })
      } catch {
        /* closed */
      }
      return
    }
    if (await copyText(href)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-brand px-5 text-base font-bold text-forest transition-colors duration-150 hover:bg-brand-pressed active:scale-[0.98] sm:w-auto"
    >
      {copied ? <Check aria-hidden className="size-5" /> : <Share2 aria-hidden className="size-5" />}
      {copied ? 'הקישור הועתק' : 'שליחת קישור לפורטל'}
      <span role="status" aria-live="polite" className="sr-only">{copied ? 'הקישור לפורטל הועתק' : ''}</span>
    </button>
  )
}
