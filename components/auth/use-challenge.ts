'use client'

import { useCallback, useEffect, useRef } from 'react'

type Start<T> = { ok: true; challengeId: string; options: T } | { ok: false; code: string }

/** Supabase keeps a challenge 5 minutes; use one only while it is clearly fresh. */
const FRESH_MS = 4 * 60_000

/**
 * Fetches the passkey challenge BEFORE the tap. Safari only lets a page open
 * the Face ID sheet shortly after the person's tap; a server round trip in
 * between can use that window up, and the sheet then fails as "cancelled".
 * With the challenge already here, the tap goes straight to Face ID.
 * A challenge is single-use: `take()` hands it out once and fetches the next.
 */
export function usePrefetchedChallenge<T>(start: () => Promise<Start<T>>, enabled: boolean) {
  const held = useRef<{ at: number; value: Promise<Start<T>> } | null>(null)
  const startRef = useRef(start)
  startRef.current = start

  const fetchNext = useCallback(() => {
    const value = startRef.current().catch((): Start<T> => ({ ok: false, code: 'unknown' }))
    held.current = { at: Date.now(), value }
    return value
  }, [])

  useEffect(() => {
    if (enabled) void fetchNext()
  }, [enabled, fetchNext])

  return useCallback(async (): Promise<Start<T>> => {
    const h = held.current
    held.current = null
    const value = h && Date.now() - h.at < FRESH_MS ? await h.value : await startRef.current()
    // Ready for the next attempt (a cancelled sheet, a second device).
    void fetchNext()
    return value.ok ? value : await startRef.current()
  }, [fetchNext])
}
