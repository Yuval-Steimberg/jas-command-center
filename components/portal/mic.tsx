'use client'

import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/cn'

const quiet = 'inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border border-line bg-surface px-0 text-sm font-medium text-ink hover:bg-sunken disabled:opacity-40'

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
export function MicButton({ onText, disabled }: { onText: (t: string) => void; disabled: boolean }) {
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
        className={cn(quiet, on && 'border-bad text-bad')}
      >
        {on ? <MicOff aria-hidden className="size-5" /> : <Mic aria-hidden className="size-5" />}
      </button>
      {on ? <span className="text-sm text-bad">מקליט… דברו, ולחצו שוב כדי לעצור</span> : null}
      {error ? <span className="text-sm text-bad">{error}</span> : null}
    </>
  )
}

