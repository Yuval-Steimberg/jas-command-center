'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Loader2, RotateCcw, Send } from 'lucide-react'
import { portalAskAct } from '@/app/portal/ask/actions'
import { MicButton } from './mic'

type Turn = { role: 'user' | 'assistant'; text: string }

const MAX_HISTORY = 20

/**
 * "לשאול": a question in Hebrew, typed or spoken, answered from the live
 * systems the person may read. Questions only; nothing is changed from here.
 */
export function AskChat({ examples }: { examples: string[] }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (turns.length || pending) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns.length, pending])

  const send = (q: string) => {
    const question = q.trim()
    if (!question || pending) return
    setError(null)
    const history = turns.slice(-MAX_HISTORY)
    start(async () => {
      const r = await portalAskAct({ question, history }).catch(() => ({ ok: false as const, message: 'החיבור נכשל. נסו שוב.' }))
      if (!r.ok) {
        setError(r.message)
        return
      }
      // Only answered pairs join the history, so it always alternates.
      setTurns((t) => [...t, { role: 'user', text: question }, { role: 'assistant', text: r.answer }])
      setText('')
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {turns.length === 0 ? (
        <ul className="flex flex-col gap-2">
          {examples.map((e) => (
            <li key={e}>
              <button type="button" disabled={pending} onClick={() => send(e)} className="min-h-12 w-full rounded-lg border border-line bg-surface px-4 py-2 text-start text-base text-ink hover:bg-sunken disabled:opacity-60">
                {e}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <ol className="flex flex-col gap-3" aria-live="polite">
          {turns.map((t, i) => (
            <li key={i} className={t.role === 'user' ? 'ms-auto max-w-[85%] rounded-lg bg-forest px-4 py-3 text-cream' : 'max-w-full rounded-lg border border-line bg-surface px-4 py-3 text-ink'}>
              <p dir="auto" className="whitespace-pre-wrap break-words text-base">
                {t.text}
              </p>
            </li>
          ))}
        </ol>
      )}
      {pending ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          בודקים במערכות…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-base text-bad">
          {error}
        </p>
      ) : null}
      <div ref={end} />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
        className="sticky bottom-0 -mx-4 border-t border-line bg-ground/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:bg-surface"
      >
        <label htmlFor="ask-text" className="sr-only">
          השאלה
        </label>
        <textarea
          id="ask-text"
          dir="auto"
          rows={2}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(text)
            }
          }}
          placeholder="מה רוצים לדעת?"
          className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-base text-ink focus:border-forest focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <MicButton disabled={pending} onText={(t) => setText((p) => (p ? `${p} ${t}` : t))} />
          {turns.length ? (
            <button type="button" onClick={() => { setTurns([]); setError(null) }} className="inline-flex h-11 items-center gap-1.5 rounded-full px-3 text-sm text-muted hover:bg-sunken">
              <RotateCcw aria-hidden className="size-4" />
              שיחה חדשה
            </button>
          ) : null}
          <span className="flex-1" />
          <button type="submit" disabled={pending || !text.trim()} className="inline-flex h-11 items-center gap-1.5 rounded-full bg-forest px-5 text-sm font-bold text-cream hover:bg-forest/90 disabled:opacity-40">
            <Send aria-hidden className="size-4" />
            שליחה
          </button>
        </div>
      </form>
    </div>
  )
}
