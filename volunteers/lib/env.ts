import 'server-only'

/**
 * The volunteer app's environment. Parses only; never throws, so one missing
 * value cannot take every page down. `configured()` says what is missing.
 */
const read = (name: string): string | undefined => {
  const v = process.env[name]?.trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  return v ? v : undefined
}
const origin = (name: string): string | undefined => {
  const v = read(name)
  if (!v) return undefined
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : undefined
  } catch {
    return undefined
  }
}

export function env() {
  return {
    production: process.env.NODE_ENV === 'production',
    /** The Command Center's Supabase project: the one database both apps share. */
    supabaseUrl: origin('SUPABASE_URL') ?? origin('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseServiceKey: read('SUPABASE_SERVICE_ROLE_KEY'),
    /** Signs volunteer sessions. 32+ random characters, different from every other secret. */
    sessionSecret: read('VOLUNTEER_SESSION_SECRET'),
    appUrl: origin('VOLUNTEER_APP_URL'),
    sendgridKey: read('SENDGRID_API_KEY'),
    emailFrom: read('VOLUNTEER_EMAIL_FROM') ?? 'Just A Second · מתנדבים <volunteers@justasecond.co.il>',
    replyTo: read('VOLUNTEER_REPLY_TO'),
    teamPhone: read('VOLUNTEER_TEAM_PHONE') ?? '058-787-6549',
    cronSecret: read('CRON_SECRET'),
  }
}

/** What production still needs. Empty = ready. */
export function missingConfig(): string[] {
  const e = env()
  const out: string[] = []
  if (!e.supabaseUrl) out.push('SUPABASE_URL')
  if (!e.supabaseServiceKey) out.push('SUPABASE_SERVICE_ROLE_KEY')
  if (!e.sessionSecret || e.sessionSecret.length < 32) out.push('VOLUNTEER_SESSION_SECRET (32+ chars)')
  if (!e.sendgridKey) out.push('SENDGRID_API_KEY')
  if (!e.appUrl) out.push('VOLUNTEER_APP_URL')
  return out
}
