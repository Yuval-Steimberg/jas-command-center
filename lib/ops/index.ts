import 'server-only'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
import { memoryStore, emptyData, type MemoryData } from './memory'
import { supabaseOpsStore } from './supabase'
import type { OpsStore } from './store'
import { dropsCacheOnWrite } from './fresh'

export { ConflictError, OpsSetupError } from './store'

// One per process, on globalThis: route handlers, actions and pages are separate bundles in Next.js.
const g = globalThis as unknown as { __ccOpsData?: MemoryData }

/** Supabase in production; memory for the local development login (same semantics). */
export function getOpsStore(): OpsStore {
  if (authMode().kind === 'supabase') return dropsCacheOnWrite(supabaseOpsStore(supabaseAdmin()))
  return dropsCacheOnWrite(memoryStore((g.__ccOpsData ??= emptyData())))
}
