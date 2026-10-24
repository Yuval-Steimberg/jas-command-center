'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'
import { input } from '@/app/(app)/website/forms'

/**
 * Item search without a page reload: results follow the typing (after a short
 * pause) through the router, so the header, tab bar and keyboard stay put.
 * The query stays in the URL, so back returns to the same results.
 */
export function ShopItemSearch({ q, all }: { q: string; all: boolean }) {
  const router = useRouter()
  const path = usePathname()
  const [text, setText] = useState(q)
  const [withSold, setWithSold] = useState(all)
  const [busy, start] = useTransition()
  const first = useRef(true)

  const go = (t: string, s: boolean) => {
    const p = new URLSearchParams()
    if (t.trim()) p.set('q', t.trim())
    if (s) p.set('all', '1')
    const qs = p.toString()
    start(() => router.replace(qs ? `${path}?${qs}` : path, { scroll: false }))
  }

  useEffect(() => {
    if (first.current) { first.current = false; return }
    const t = setTimeout(() => go(text, withSold), 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, withSold])

  return (
    <form role="search" className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); go(text, withSold) }}>
      <div className="relative flex-1">
        <input name="q" value={text} onChange={(e) => setText(e.target.value)} dir="auto" placeholder="קוד, שם, קטגוריה, צבע או חומר" aria-label="חיפוש" enterKeyHint="search" className={`${input} h-12 w-full text-base`} />
        {busy ? <Loader2 aria-label="מחפש" className="absolute top-3.5 left-3 h-5 w-5 animate-spin text-muted" /> : null}
      </div>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-muted"><input type="checkbox" checked={withSold} onChange={(e) => setWithSold(e.target.checked)} className="h-5 w-5" />גם פריטים שנמכרו</label>
    </form>
  )
}
