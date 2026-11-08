'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Check, Copy, ImagePlus, Loader2, Mic, MicOff, Send, Wrench, X } from 'lucide-react'
import { applyChangeAct, askChangeAct, sendDevRequestAct } from '@/app/portal/change/actions'
import type { ChatResult, PortalChange } from '@/lib/portal/change-chat'
import { LIMITS } from '@/lib/portal/change-chat'
import { cn } from '@/lib/cn'

type CardState = 'open' | 'applying' | 'done' | 'skipped' | 'failed'
type DevState = { status: 'open' | 'sending' | 'sent' | 'failed'; message?: string; url?: string | null }

type Msg =
  | { role: 'owner'; text: string; images: string[] }
  | { role: 'assistant'; text: string; result?: ChatResult; canApply?: boolean; cards: { state: CardState; message?: string }[]; dev?: DevState }
  | { role: 'error'; text: string }

const btn = 'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium disabled:opacity-40'
const primary = `${btn} bg-forest text-cream hover:bg-forest/90`
const quiet = `${btn} border border-line bg-surface text-ink hover:bg-sunken`

const EXAMPLES = ['לשנות את השם של "רישום מכירה" ל"מכירה בקופה"', 'להעביר את "שוברי מתנה" להיות הקטגוריה הראשונה', 'אני רוצה שהכפתורים יהיו גדולים יותר בטלפון']

/** A screenshot, resized in the browser to a JPEG Claude reads well and the request stays small. */
async function toJpeg(file: File, max = 1600): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = bad
      i.src = url
    })
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', 0.85)
    return data.length <= LIMITS.imageChars ? data : null
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  stop(): void
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
}

function speechCtor(): (new () => Recognition) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Free browser speech-to-text in Hebrew (Chrome, Edge, Safari). Text lands in the box, so it can be fixed before sending. */
function MicButton({ onText, disabled }: { onText: (t: string) => void; disabled: boolean }) {
  const [supported, setSupported] = useState(false)
  const [on, setOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rec = useRef<Recognition | null>(null)
  useEffect(() => {
    setSupported(!!speechCtor())
    return () => rec.current?.stop()
  }, [])
  if (!supported) return null
  const toggle = () => {
    if (on) {
      rec.current?.stop()
      return
    }
    const Ctor = speechCtor()
    if (!Ctor) return
    const r = new Ctor()
    r.lang = 'he-IL'
    r.continuous = true
    r.interimResults = false
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i]!.isFinal) onText(e.results[i]![0].transcript.trim())
    }
    r.onend = () => setOn(false)
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' ? 'צריך לאשר לדפדפן גישה למיקרופון.' : 'ההקלטה נעצרה. אפשר לנסות שוב.')
      setOn(false)
    }
    setError(null)
    rec.current = r
    r.start()
    setOn(true)
  }
  return (
    <>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-pressed={on}
        aria-label={on ? 'עצירת ההקלטה' : 'הקלטה בקול'}
        title={on ? 'עצירת ההקלטה' : 'הקלטה בקול'}
        className={cn(quiet, 'px-0', on && 'border-bad text-bad')}
      >
        {on ? <MicOff aria-hidden className="size-5" /> : <Mic aria-hidden className="size-5" />}
      </button>
      {on ? <span className="text-sm text-bad">מקליט… דברו, ולחצו שוב כדי לעצור</span> : null}
      {error ? <span className="text-sm text-bad">{error}</span> : null}
    </>
  )
}

function ChangeCard({ change, state, message, canApply, onApply, onSkip }: { change: PortalChange; state: CardState; message?: string; canApply: boolean; onApply: () => void; onSkip: () => void }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="font-bold text-ink">{change.summary}</p>
      <div className={cn('mt-3 grid gap-3', change.show.before && 'sm:grid-cols-2')}>
        {change.show.before ? (
          <div className="rounded-md bg-sunken p-3">
            <p className="mb-1 text-xs font-medium text-muted">עכשיו</p>
            <p className="whitespace-pre-line text-sm text-muted">{change.show.before}</p>
          </div>
        ) : null}
        <div className="rounded-md bg-sage-soft p-3">
          <p className="mb-1 text-xs font-medium text-forest">{change.show.before ? 'אחרי האישור' : change.mode === 'move' ? `"${change.show.title}"` : 'חדש'}</p>
          <p className="whitespace-pre-line text-sm text-ink">{change.show.after}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {state === 'done' ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-ok">
            <Check aria-hidden className="size-4" />
            {message ?? 'פורסם'}
          </span>
        ) : state === 'skipped' ? (
          <span className="text-sm text-muted">לא בוצע</span>
        ) : (
          <>
            <button type="button" className={primary} disabled={!canApply || state === 'applying'} onClick={onApply}>
              {state === 'applying' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Check aria-hidden className="size-4" />}
              אישור ופרסום
            </button>
            <button type="button" className={quiet} disabled={state === 'applying'} onClick={onSkip}>
              לא, תודה
            </button>
            {state === 'failed' && message ? <span role="alert" className="text-sm text-bad">{message}</span> : null}
            {!canApply ? <span className="text-sm text-warn">אי אפשר לשמור עכשיו: רשימת הקישורים לא נטענה מהמסד.</span> : null}
          </>
        )}
      </div>
    </div>
  )
}

function DevCard({ req, dev, onSend }: { req: { subject: string; details: string }; dev: DevState; onSend: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${req.subject}\n\n${req.details}`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="rounded-lg border border-forest/30 bg-surface p-4">
      <p className="flex items-center gap-2 font-bold text-ink">
        <Wrench aria-hidden className="size-4 text-forest" />
        בקשה לפיתוח: {req.subject}
      </p>
      <p className="mt-1 text-sm text-muted">את זה אי אפשר לשנות מכאן ישירות: זה שינוי בקוד. Claude כתב את הבקשה המלאה; אחרי השליחה מכינים את השינוי, ומעלים אותו אחרי שמישהו בודק ומאשר.</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-sm text-forest">מה בדיוק יבוקש</summary>
        <p className="mt-2 whitespace-pre-line rounded-md bg-sunken p-3 text-sm text-ink">{req.details}</p>
      </details>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {dev.status === 'sent' ? (
          <span className="inline-flex items-center gap-1.5 text-sm text-ok">
            <Check aria-hidden className="size-4" />
            {dev.message}
            {dev.url ? (
              <a href={dev.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                לצפייה
              </a>
            ) : null}
          </span>
        ) : (
          <>
            <button type="button" className={primary} disabled={dev.status === 'sending'} onClick={onSend}>
              {dev.status === 'sending' ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Send aria-hidden className="size-4" />}
              שליחה לפיתוח
            </button>
            <button type="button" className={quiet} onClick={copy}>
              <Copy aria-hidden className="size-4" />
              {copied ? 'הועתק' : 'העתקה'}
            </button>
            {dev.status === 'failed' && dev.message ? <span role="alert" className="text-sm text-bad">{dev.message}</span> : null}
          </>
        )}
      </div>
    </div>
  )
}

export function ChangeChat({ configured }: { configured: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [imgError, setImgError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const file = useRef<HTMLInputElement>(null)
  const end = useRef<HTMLDivElement>(null)

  // Braces matter: newer browsers return a Promise from scrollIntoView, and an effect may only return a cleanup function.
  useEffect(() => {
    if (msgs.length || pending) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [msgs.length, pending])

  const addFiles = async (files: Iterable<File>) => {
    setImgError(null)
    const room = LIMITS.imagesPerTurn - images.length
    const list = [...files].slice(0, Math.max(0, room))
    const out = (await Promise.all(list.map((f) => toJpeg(f)))).filter((x): x is string => !!x)
    if (out.length < list.length) setImgError('חלק מהתמונות לא נקראו. אפשר לנסות צילום מסך אחר.')
    if ([...files].length > room) setImgError(`עד ${LIMITS.imagesPerTurn} תמונות בכל הודעה.`)
    setImages((prev) => [...prev, ...out].slice(0, LIMITS.imagesPerTurn))
  }

  type Turn = { role: 'owner' | 'assistant'; text: string; images?: string[] }
  const conversation = (list: Msg[]): Turn[] =>
    list.flatMap((m): Turn[] => (m.role === 'owner' ? [{ role: 'owner', text: m.text, images: m.images }] : m.role === 'assistant' ? [{ role: 'assistant', text: m.text }] : []))

  const send = () => {
    const t = text.trim()
    if ((!t && !images.length) || pending) return
    const next: Msg[] = [...msgs, { role: 'owner', text: t, images }]
    setMsgs(next)
    setText('')
    setImages([])
    start(async () => {
      const res = await askChangeAct(conversation(next)).catch(() => ({ ok: false as const, message: 'החיבור נכשל. נסו שוב.' }))
      setMsgs((m) => [
        ...m,
        res.ok
          ? {
              role: 'assistant',
              text: res.result.reply,
              result: res.result,
              canApply: res.canApply,
              cards: res.result.changes.map(() => ({ state: 'open' as CardState })),
              dev: res.result.developerRequest ? { status: 'open' } : undefined,
            }
          : { role: 'error', text: res.message },
      ])
    })
  }

  const setCard = (mi: number, ci: number, s: { state: CardState; message?: string }) =>
    setMsgs((m) => m.map((x, i) => (i === mi && x.role === 'assistant' ? { ...x, cards: x.cards.map((c, j) => (j === ci ? s : c)) } : x)))
  const setDev = (mi: number, d: DevState) => setMsgs((m) => m.map((x, i) => (i === mi && x.role === 'assistant' ? { ...x, dev: d } : x)))

  const apply = async (mi: number, ci: number, change: PortalChange) => {
    setCard(mi, ci, { state: 'applying' })
    const r = await applyChangeAct(change).catch(() => ({ ok: false, message: 'החיבור נכשל. נסו שוב.' }))
    setCard(mi, ci, { state: r.ok ? 'done' : 'failed', message: r.message })
  }

  const sendDev = async (mi: number, req: { subject: string; details: string }) => {
    setDev(mi, { status: 'sending' })
    const convo = conversation(msgs)
    const r = await sendDevRequestAct({
      ...req,
      conversation: convo.map(({ role, text }) => ({ role, text })),
      screenshots: convo.reduce((n, t) => n + (t.images?.length ?? 0), 0),
    }).catch(() => ({ ok: false as const, message: 'החיבור נכשל. נסו שוב.' }))
    setDev(mi, r.ok ? { status: 'sent', message: r.message, url: r.url } : { status: 'failed', message: r.message })
  }

  if (!configured)
    return <p className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">החיבור ל-Claude עוד לא הוגדר במערכת (ANTHROPIC_API_KEY). אחרי שמגדירים אותו, אפשר לבקש כאן שינויים.</p>

  return (
    <div className="flex flex-col gap-4">
      {msgs.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-4">
          <p className="text-base text-ink">כתבו, הקליטו או צלמו מסך, ותגידו מה לשנות. למשל:</p>
          <ul className="mt-2 flex flex-col gap-2">
            {EXAMPLES.map((e) => (
              <li key={e}>
                <button type="button" onClick={() => setText(e)} className="min-h-11 w-full rounded-md bg-sunken px-3 py-2 text-start text-sm text-ink hover:bg-sage-soft">
                  {e}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {msgs.map((m, mi) =>
        m.role === 'owner' ? (
          <div key={mi} className="ms-auto max-w-[85%] rounded-lg bg-forest px-4 py-3 text-cream">
            {m.images.length ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {m.images.map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt={`צילום מסך ${i + 1}`} className="h-20 rounded-md object-cover" />
                ))}
              </div>
            ) : null}
            {m.text ? <p className="whitespace-pre-line text-base">{m.text}</p> : null}
          </div>
        ) : m.role === 'error' ? (
          <p key={mi} role="alert" className="rounded-lg border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
            {m.text}
          </p>
        ) : (
          <div key={mi} className="flex max-w-full flex-col gap-3">
            <p className="whitespace-pre-line text-base text-ink">{m.text}</p>
            {m.result?.changes.map((c, ci) => (
              <ChangeCard
                key={ci}
                change={c}
                state={m.cards[ci]!.state}
                message={m.cards[ci]!.message}
                canApply={!!m.canApply}
                onApply={() => apply(mi, ci, c)}
                onSkip={() => setCard(mi, ci, { state: 'skipped' })}
              />
            ))}
            {m.result?.dropped.length ? (
              <div className="rounded-lg border border-warn/30 bg-warn/5 px-4 py-3 text-sm text-warn">
                <p className="font-medium">את זה לא נשנה, כי זה לא עובר את הבדיקות:</p>
                <ul className="mt-1 list-disc ps-5">
                  {m.result.dropped.map((d, i) => (
                    <li key={i}>
                      {d.summary}: {d.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {m.result?.developerRequest && m.dev ? <DevCard req={m.result.developerRequest} dev={m.dev} onSend={() => sendDev(mi, m.result!.developerRequest!)} /> : null}
          </div>
        ),
      )}

      {pending ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted">
          <Loader2 aria-hidden className="size-4 animate-spin" />
          Claude קורא את הבקשה…
        </p>
      ) : null}
      <div ref={end} />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
        className="sticky bottom-0 -mx-4 border-t border-line bg-ground/95 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:bg-surface"
      >
        {images.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((src, i) => (
              <span key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`צילום מסך ${i + 1}`} className="h-16 rounded-md border border-line object-cover" />
                <button
                  type="button"
                  aria-label="הסרת התמונה"
                  onClick={() => setImages((p) => p.filter((_, j) => j !== i))}
                  className="absolute -end-2 -top-2 grid size-7 place-items-center rounded-full border border-line bg-surface text-ink"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <label htmlFor="change-text" className="sr-only">
          מה לשנות
        </label>
        <textarea
          id="change-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
            if (files.length) {
              e.preventDefault()
              void addFiles(files)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          rows={3}
          maxLength={LIMITS.textChars}
          placeholder="מה לשנות בפורטל?"
          className="w-full resize-y rounded-md border border-line bg-surface px-3 py-2 text-base text-ink focus:border-forest focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <MicButton disabled={pending} onText={(t) => setText((p) => (p ? `${p} ${t}` : t))} />
          <button type="button" onClick={() => file.current?.click()} disabled={pending || images.length >= LIMITS.imagesPerTurn} aria-label="צירוף צילום מסך" title="צירוף צילום מסך" className={cn(quiet, 'px-0')}>
            <ImagePlus aria-hidden className="size-5" />
          </button>
          <input
            ref={file}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          {imgError ? <span className="text-sm text-bad">{imgError}</span> : null}
          <span className="flex-1" />
          <button type="submit" disabled={pending || (!text.trim() && !images.length)} className={primary}>
            <Send aria-hidden className="size-4" />
            שליחה
          </button>
        </div>
      </form>
    </div>
  )
}
