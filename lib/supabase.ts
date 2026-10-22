import 'server-only'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from '@/lib/env'

/** The signed-in user's client (RLS applies). Command center project only. */
export function supabaseUserClient(): SupabaseClient {
  const e = env()
  const store = cookies()
  return createServerClient(e.cc.supabaseUrl!, e.cc.supabaseAnonKey!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options)
        } catch {
          // Called from a Server Component: middleware refreshes the cookie instead.
        }
      },
    },
  })
}

let admin: SupabaseClient | null = null
/** Service-role client for the COMMAND CENTER's own database. Server only; never for source systems. */
export function supabaseAdmin(): SupabaseClient {
  const e = env()
  admin ??= createClient(e.cc.supabaseUrl!, e.cc.supabaseServiceKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return admin
}
