'use client'

import { useRef, useState, useTransition } from 'react'
import { askAction, confirmProposalAction } from './actions'
import type { Turn } from '@/lib/assistant/run'
import type { Proposal } from '@/lib/assistant/proposals'

interface Entry extends Turn {
  toolsUsed?: string[]
  notice?: string
  proposals?: Proposal[]
}

/** One proposed action. Nothing runs until the person presses Confirm; it can run once. */
function ProposalCard({ p }: { p: Proposal }) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'dismissed'>('idle')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  if (state === 'dismissed') return <p className="text-meta text-muted">Dismissed: nothing was done.</p>
  return (
    <div className="mt-2 rounded-md border border-line bg-sunken/50 px-3 py-2">
      <p className="text-xs font-semibold text-muted">Needs your confirmation</p>
      <p dir="auto" className="text-sm text-ink">{p.summary}</p>
      {state === 'done' && result ? (
        <p role="status" dir="auto" className={result.ok ? 'mt-1 text-sm text-ok' : 'mt-1 text-sm text-bad'}>{result.message}</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            disabled={state === 'running'}
            onClick={async () => {
              setState('running')
              const res = await confirmProposalAction({ kind: p.kind, params: p.params }).catch(() => ({ ok: false, message: 'The request failed. Nothing is known to have changed; check the page before retrying.' }))
              setResult(res)
              setState('done')
            }}
            className="h-10 rounded-full bg-brand px-4 text-sm font-semibold text-forest hover:bg-brand-pressed hover:text-cream disabled:opacity-60"
          >
            {state === 'running' ? 'Running…' : 'Confirm'}
          </button>
          <button type="button" disabled={state === 'running'} onClick={() => setState('dismissed')} className="h-10 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken disabled:opacity-60">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
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
      setEntries((prev) => [...prev, { role: 'user', text }, { role: 'assistant', text: res.answer, toolsUsed: res.toolsUsed, notice: res.notice, proposals: res.proposals }])
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
              {m.proposals?.map((p, j) => <ProposalCard key={j} p={p} />)}
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
