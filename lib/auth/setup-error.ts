/**
 * The command center's own database cannot be used: tables missing, key
 * rejected, project unreachable. Carries a reason a person can act on. It is
 * caught by sessionState() so that a setup mistake shows on /login instead of
 * crashing every page (a throw in a layout is not caught by error.tsx).
 */
export class SetupError extends Error {}

/** Turn a PostgREST/Supabase error into the setup step that fixes it. Never includes a key. */
export function diagnoseSetupError(e: { message?: string; code?: string } | null | undefined): SetupError {
  const msg = e?.message ?? 'unknown error'
  if (e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|could not find the table/i.test(msg))
    return new SetupError('The command center database is not set up. In its Supabase project, run supabase/migrations/0001_init.sql in the SQL Editor, then supabase/add-staff.sql.')
  if (/invalid api key|jwt|apikey|unauthorized|401/i.test(msg))
    return new SetupError('Supabase rejected SUPABASE_SERVICE_ROLE_KEY. Check it is the secret (service_role) key of the SAME project as NEXT_PUBLIC_SUPABASE_URL, with no quotes or spaces, then redeploy.')
  if (/fetch failed|enotfound|econnrefused|network/i.test(msg))
    return new SetupError('The command center could not reach its Supabase project. Check NEXT_PUBLIC_SUPABASE_URL (https://<ref>.supabase.co) and redeploy.')
  return new SetupError(`The command center database returned an error: ${msg}`)
}
