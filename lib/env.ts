import 'server-only'

/**
 * Server-side environment. Parses only — it never throws for a missing value,
 * because it is read on hot paths (auth) and one missing integration key must
 * never take the whole command center down. Each integration decides for itself
 * what "configured" means and reports the exact missing variables.
 */
const read = (name: string): string | undefined => {
  // Dashboards make it easy to paste a value with its quotes: "abc" → abc.
  const v = process.env[name]?.trim().replace(/^(['"])(.*)\1$/, '$2').trim()
  return v ? v : undefined
}

const url = (name: string): string | undefined => {
  const v = read(name)
  if (!v) return undefined
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return undefined
    return u.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export function env() {
  return {
    isProduction: process.env.NODE_ENV === 'production',
    cc: {
      supabaseUrl: url('NEXT_PUBLIC_SUPABASE_URL'),
      supabaseAnonKey: read('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      supabaseServiceKey: read('SUPABASE_SERVICE_ROLE_KEY'),
      /** Signs the local development session. Ignored when Supabase Auth is configured. */
      devPassword: read('CC_DEV_PASSWORD'),
      sessionSecret: read('CC_SESSION_SECRET'),
    },
    website: { url: url('WEBSITE_URL'), agentKey: read('WEBSITE_AGENT_API_KEY') },
    giftCards: { url: url('GIFT_CARDS_URL'), integrationKey: read('GIFT_CARDS_INTEGRATION_KEY') },
    furniture: {
      supabaseUrl: url('FURNITURE_SUPABASE_URL'),
      supabaseKey: read('FURNITURE_SUPABASE_KEY'),
      appUrl: url('FURNITURE_APP_URL'),
    },
    designAgent: { url: url('DESIGN_AGENT_URL'), adminToken: read('DESIGN_AGENT_ADMIN_TOKEN') },
    map: {
      siteUrl: url('MAP_SITE_URL') ?? 'https://map.justasecond.co.il',
      repo: read('MAP_GITHUB_REPO') ?? 'Yuval-Steimberg/Interactive-map',
      branch: read('MAP_GITHUB_BRANCH') ?? 'main',
      githubToken: read('GITHUB_TOKEN'),
    },
    /** The read-only AI assistant. Off (and saying so) until the key is set. */
    assistant: { apiKey: read('ANTHROPIC_API_KEY'), model: read('ASSISTANT_MODEL') ?? 'claude-opus-5-5' },
  }
}

export type Env = ReturnType<typeof env>
