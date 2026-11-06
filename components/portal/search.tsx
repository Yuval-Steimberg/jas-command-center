'use client'

import { useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import { normalize } from '@/lib/search/match'
import { ActionRow, type ActionView } from './action-row'

/**
 * "חיפוש לפי שם, פעולה או מערכת": filters the actions this person can use,
 * across all categories, as they type. While a search is on, the category
 * cards step aside so the results are the only thing on screen.
 */
export function PortalSearch({ items, children }: { items: (ActionView & { text: string })[]; children: React.ReactNode }) {
  const [q, setQ] = useState('')
  const query = normalize(q)
  const results = useMemo(() => {
    if (query.length < 2) return null
    const words = query.split(' ')
    return items.filter((i) => words.every((w) => i.text.includes(w)))
  }, [items, query])

  return (
    <>
      <div role="search" className="relative">
        <label htmlFor="portal-search" className="sr-only">חיפוש</label>
        <Search aria-hidden className="pointer-events-none absolute inset-y-0 start-4 my-auto size-5 text-muted" />
        <input
          id="portal-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש לפי שם, פעולה או מערכת"
          autoComplete="off"
          enterKeyHint="search"
          className="h-12 w-full rounded-full border border-line bg-surface ps-12 pe-12 text-base text-ink shadow-card placeholder:text-faint focus:border-forest focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {q ? (
          <button type="button" onClick={() => setQ('')} aria-label="ניקוי החיפוש" className="absolute inset-y-0 end-1 my-auto inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-sunken hover:text-ink">
            <X aria-hidden className="size-5" />
          </button>
        ) : null}
      </div>
      {results ? (
        <section aria-label="תוצאות החיפוש" className="mt-5">
          <p role="status" aria-live="polite" className="mb-3 text-sm text-muted">
            {results.length ? `נמצאו ${results.length} פעולות` : 'לא נמצאה פעולה כזו. אפשר לנסות מילה אחרת, למשל "מכירה" או "מתנדבים".'}
          </p>
          <ul className="flex flex-col gap-3">
            {results.map((a) => (
              <ActionRow key={a.id} a={a} />
            ))}
          </ul>
        </section>
      ) : (
        children
      )}
    </>
  )
}
