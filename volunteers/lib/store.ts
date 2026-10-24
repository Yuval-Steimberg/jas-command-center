import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { emptyVolData, memoryVolunteerStore, type MemoryVolData, type VolunteerStore } from '@shared/volunteers/store'
import { supabaseVolunteerStore } from '@shared/volunteers/supabase'
import { env } from './env'
import { seedDemo } from './demo'

export class NotConfiguredError extends Error {}

const g = globalThis as unknown as { __jvStore?: VolunteerStore; __jvData?: MemoryVolData }

/**
 * Production: the Command Center's Supabase (the one source of truth).
 * Development without it: an in-memory store with a little demo data. A
 * production build without the database never falls back to memory, because
 * a sign-up that lives in memory is a sign-up that disappears.
 */
export function getStore(): VolunteerStore {
  if (g.__jvStore) return g.__jvStore
  const e = env()
  if (e.supabaseUrl && e.supabaseServiceKey) {
    g.__jvStore = supabaseVolunteerStore(createClient(e.supabaseUrl, e.supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false } }))
  } else if (!e.production) {
    g.__jvData ??= seedDemo(emptyVolData())
    g.__jvStore = memoryVolunteerStore(g.__jvData)
  } else {
    throw new NotConfiguredError('The volunteer database is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).')
  }
  return g.__jvStore
}
