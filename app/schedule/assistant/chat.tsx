'use client'

import { useRef, useState, useTransition } from 'react'
import { askScheduleAction, confirmScheduleProposalAction } from './actions'
import type { ScheduleProposal, Turn } from '@/lib/schedule/assistant'

interface Entry extends Turn {
  proposals?: ScheduleProposal[]
}

const EXAMPLES = ['איפה חסרים מתנדבים בשבוע הבא?', 'מי משובץ ביום רביעי?', 'כמה חסרים ביום שני הקרוב?', 'תראה לי את כל ההיעדרויות של השבוע הבא', 'תשבץ את רותי במקום יוסי ביום שלישי']

/** One proposed change. Nothing runs until the person presses אישור, and it runs once. */
function ProposalCard({ p }: { p: ScheduleProposal }) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'dismissed'>('idle')
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  if (state === 'dismissed') return <p className="text-xs text-muted">בוטל: לא שונה דבר.</p>
  return (
    <div className="mt-2 rounded-md border border-line bg-sunken/50 px-3 py-2">
      <p className="text-xs font-semibold text-muted">נדרש אישור</p>
      <p className="text-sm text-ink">{p.summary}</p>
      {state === 'done' && result ? (
        <p role="status" className={result.ok ? 'mt-1 text-sm text-ok' : 'mt-1 text-sm text-bad'}>{result.message}</p>
      ) : (
        <div className="mt-2 flex gap-2">
          <button type="button" disabled={state === 'running'} onClick={async () => {
            setState('running')
            setResult(await confirmScheduleProposalAction({ kind: p.kind, params: p.params }).catch(() => ({ ok: false, message: 'הבקשה נכשלה. נא לבדוק את הלוח לפני שמנסים שוב.' })))
            setState('done')
          }} className="h-11 rounded-full bg-brand px-5 text-sm font-semibold text-forest hover:bg-brand-pressed hover:text-cream disabled:opacity-60">
            {state === 'running' ? 'מבצע…' : 'אישור'}
          </button>
          <button type="button" disabled={state === 'running'} onClick={() => setState('dismissed')} className="h-11 rounded-full border border-line px-4 text-sm font-medium hover:bg-sunken disabled:opacity-60">ביטול</button>
        </div>
      )}
    </div>
  )
}

export function ScheduleChat() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [question, setQuestion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const ref = useRef<HTMLTextAreaElement>(null)

  function submit(q: string) {
    const text = q.trim()
    if (!text || pending) return
    setError(null)
    const history: Turn[] = entries.slice(-20).map(({ role, text }) => ({ role, text }))
    start(async () => {
      const res = await askScheduleAction({ question: text, history }).catch(() => ({ ok: false as const, message: 'הבקשה נכשלה. אפשר לנסות שוב.' }))
      if (!res.ok) return setError(res.message)
      setEntries((prev) => [...prev, { role: 'user', text }, { role: 'assistant', text: res.answer, proposals: res.proposals }])
      setQuestion('')
      ref.current?.focus()
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {entries.length === 0 ? (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((e) => <button key={e} type="button" onClick={() => submit(e)} disabled={pending} className="min-h-11 rounded-full border border-line bg-surface px-3 text-sm text-ink hover:bg-sunken disabled:opacity-60">{e}</button>)}
        </div>
      ) : (
        <ol className="flex flex-col gap-3">
          {entries.map((e, i) => (
            <li key={i} className={e.role === 'user' ? 'self-start max-w-[85%] rounded-lg bg-sage-soft px-3 py-2 text-sm text-ink' : 'max-w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink'}>
              <p className="whitespace-pre-wrap" dir="auto">{e.text}</p>
              {e.proposals?.map((p, j) => <ProposalCard key={j} p={p} />)}
            </li>
          ))}
        </ol>
      )}
      {pending ? <p role="status" className="text-sm text-muted">בודק בלוח…</p> : null}
      {error ? <p role="alert" className="rounded-lg border border-bad/30 bg-bad/5 p-3 text-sm text-bad">{error}</p> : null}
      <form onSubmit={(e) => { e.preventDefault(); submit(question) }} className="flex flex-col gap-2">
        <label htmlFor="sched-q" className="sr-only">שאלה לעוזר</label>
        <textarea id="sched-q" ref={ref} value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} maxLength={2000} placeholder="למשל: מי חסר ביום שלישי?" className="w-full rounded-lg border border-line bg-surface p-3 text-ink" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(question) } }} />
        <button type="submit" disabled={pending || !question.trim()} className="inline-flex min-h-11 items-center justify-center self-end rounded-full bg-forest px-5 text-sm font-semibold text-cream hover:bg-forest/90 disabled:opacity-60">שליחה</button>
      </form>
    </div>
  )
}
