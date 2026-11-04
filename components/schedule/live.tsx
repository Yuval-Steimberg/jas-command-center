'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'

const TABLES = ['cc_vol_absences', 'cc_vol_assignments', 'cc_vol_regulars', 'cc_vol_slots', 'cc_vol_closures'] as const
const FALLBACK_MS = 30_000

/**
 * Keeps the schedule screens current. With Supabase it subscribes to
 * postgres_changes on the five schedule tables AS THE SIGNED-IN PERSON, so
 * Realtime delivers only rows RLS lets her read (0011), and re-renders the
 * page from the server when anything changes: a volunteer's absence shows up
 * within a second or two. Without a live connection (local development, a
 * dropped socket) it refreshes every 30 seconds and whenever the tab comes back.
 */
export function LiveSchedule({ url, anonKey }: { url: string | null; anonKey: string | null }) {
  const router = useRouter()
  const [live, setLive] = useState<'connecting' | 'live' | 'polling'>(url && anonKey ? 'connecting' : 'polling')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const refresh = () => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => router.refresh(), 400)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    let poll: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      setLive('polling')
      poll ??= setInterval(() => { if (document.visibilityState === 'visible') router.refresh() }, FALLBACK_MS)
    }
    if (!url || !anonKey) {
      startPolling()
      return () => {
        document.removeEventListener('visibilitychange', onVisible)
        if (poll) clearInterval(poll)
      }
    }
    const supabase = createBrowserClient(url, anonKey)
    let channel = supabase.channel('volunteer-schedule')
    for (const table of TABLES) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setLive('live')
        if (poll) clearInterval(poll)
        poll = null
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') startPolling()
    })
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (poll) clearInterval(poll)
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
  }, [url, anonKey, router])

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" role="status">
      <span aria-hidden className={`h-2 w-2 rounded-full ${live === 'live' ? 'bg-ok' : live === 'connecting' ? 'bg-warn' : 'bg-faint'}`} />
      {live === 'live' ? 'מתעדכן בזמן אמת' : live === 'connecting' ? 'מתחבר…' : 'מתעדכן כל 30 שניות'}
    </span>
  )
}
