'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, ScanLine } from 'lucide-react'
import { input } from '@/app/(app)/website/forms'

export interface StatusOption { value: string; label: string; count: number | null }

/**
 * Item search without a page reload: results follow the typing (after a short
 * pause) through the router, so the header, tab bar and keyboard stay put.
 * The query and the status stay in the URL, so back returns to the same list.
 */
export function ShopItemSearch({ q, status, options }: { q: string; status: string; options: StatusOption[] }) {
  const router = useRouter()
  const path = usePathname()
  const [text, setText] = useState(q)
  const [st, setSt] = useState(status)
  const [busy, start] = useTransition()
  const first = useRef(true)

  const go = (t: string, s: string) => {
    const p = new URLSearchParams()
    if (t.trim()) p.set('q', t.trim())
    if (s !== 'stock') p.set('s', s)
    const qs = p.toString()
    start(() => router.replace(qs ? `${path}?${qs}` : path, { scroll: false }))
  }

  useEffect(() => {
    if (first.current) { first.current = false; return }
    const t = setTimeout(() => go(text, st), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, st])

  return (
    <form role="search" className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); go(text, st) }}>
      <div className="flex flex-1 gap-2">
        <div className="relative flex-1">
          <input name="q" value={text} onChange={(e) => setText(e.target.value)} dir="rtl" placeholder="קוד, שם, קטגוריה, צבע או חומר" aria-label="חיפוש" enterKeyHint="search" className={`${input.replace('px-3', 'ps-3 pe-10')} h-12 w-full text-base`} />
          {busy ? <Loader2 aria-label="מחפש" className="absolute top-3.5 left-3 h-5 w-5 animate-spin text-muted" /> : null}
        </div>
        <Link href="/shop/scan" aria-label="סריקת תווית" title="סריקת תווית" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-forest hover:bg-sunken"><ScanLine aria-hidden className="h-6 w-6" /></Link>
      </div>
      <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="סטטוס" className={`${input} h-12 sm:w-48`}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}{o.count != null ? ` (${o.count})` : ''}</option>)}
      </select>
    </form>
  )
}
