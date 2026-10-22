'use client'

import { useRef, useState, useTransition } from 'react'
import { askAction } from './actions'
import type { Turn } from '@/lib/assistant/run'

interface Entry extends Turn {
  toolsUsed?: string[]
  notice?: string
}

/** Questions the assistant answers today; each maps to one or two read tools. */
const EXAMPLES = ['What needs my attention right now?', 'How did the shop do in the last 7 days compared with the week before?', 'Are any paid gift cards undelivered?', 'איך מתקדמים פרויקטי איסוף הרהיטים?']

/** Only answered pairs go back to the server; a failed question is not part of the history. */
const MAX_HISTORY = 20

export function AssistantChat({ labels }: { labels: Record<string, string> }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [question, setQuestion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const inputRef = useRef<HTMLTextAreaElement>(null)

  function submit(q: string) {
    const text = q.trim()
    if (!text || pending) return
    setError(null)
    const history: Turn[] = entries.slice(-MAX_HISTORY).map(({ role, text }) => ({ role, text }))
    start(async () => {
      const res = await askAction({ question: text, history })
      if (!res.ok) {
        setError(res.message)
        return
      }
      setEntries((prev) => [...prev, { role: 'user', text }, { role: 'assistant', text: res.answer, toolsUsed: res.toolsUsed, notice: res.notice }])
      setQuestion('')
      inputRef.current?.focus()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} type="button" dir="auto" onClick={() => submit(e)} disabled={pending} className="rounded-full border border-line px-3 py-1.5 text-start text-sm hover:bg-sunken disabled:opacity-60">
              {e}
            </button>
          ))}
        </div>
      ) : (
        <ol className="flex flex-col gap-3" aria-live="polite">
          {entries.map((m, i) => (
            <li key={i} className={m.role === 'user' ? 'self-end max-w-[85%] rounded-lg bg-sage/40 px-3 py-2' : 'max-w-full rounded-lg border border-line bg-surface px-3 py-2'}>
              <p dir="auto" className="whitespace-pre-wrap break-words text-sm text-ink">
                {m.text}
              </p>
              {m.role === 'assistant' && (m.toolsUsed?.length || m.notice) ? (
                <p className="mt-2 text-meta text-muted">
                  {m.toolsUsed?.length ? `Checked: ${m.toolsUsed.map((t) => labels[t] ?? t).join(', ')}` : 'Answered without checking any system'}
                  {m.notice ? ` · ${m.notice}` : ''}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      )}

      {error ? (
        <p role="alert" className="rounded-md border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(question)
        }}
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          <span className="sr-only">Question</span>
          <textarea
            ref={inputRef}
            dir="auto"
            rows={2}
            maxLength={2000}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit(question)
              }
            }}
            placeholder="Ask about sales, gift cards, projects, the design agent or the map"
            className="min-h-11 w-full resize-y rounded-md border border-line bg-surface px-3 py-2"
          />
        </label>
        <button disabled={pending || !question.trim()} className="h-11 shrink-0 rounded-full bg-brand px-5 text-sm font-semibold text-forest transition-colors hover:bg-brand-pressed hover:text-cream disabled:opacity-60">
          {pending ? 'Checking…' : 'Ask'}
        </button>
      </form>
      {entries.length ? (
        <button type="button" onClick={() => { setEntries([]); setError(null) }} className="self-start text-meta text-muted underline-offset-2 hover:underline">
          Start a new conversation
        </button>
      ) : null}
    </div>
  )
}
