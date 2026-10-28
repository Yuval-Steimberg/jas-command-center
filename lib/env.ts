import 'server-only'
import { JAS_GROW } from '@/lib/payments/grow-terminal'

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
    // Every source lives at the root of its host, so only the origin is kept: a pasted
    // https://x.supabase.co/rest/v1/ or https://gift.example/admin would otherwise
    // become /rest/v1/rest/v1/projects or /admin/api/health and 404.
    return u.origin
  } catch {
    return undefined
  }
}

const PRODUCTION_URL = 'https://jas-command-center.vercel.app'
/**
 * A localhost CC_APP_URL copied into a deployment would put a dev address in
 * every invitation and email link; in a production build it is ignored.
 */
export function appUrl(configured: string | undefined, production: boolean): string {
  if (!configured) return PRODUCTION_URL
  if (production && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(configured)) return PRODUCTION_URL
  return configured
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
      /** This deployment's public URL: invite links and links inside emails. */
      appUrl: appUrl(url('CC_APP_URL'), process.env.NODE_ENV === 'production'),
    },
    /** agentKey reads the analytics snapshot; commandKey (the website's COMMAND_CENTER_API_KEY) reads and changes orders and products. */
    website: { url: url('WEBSITE_URL'), agentKey: read('WEBSITE_AGENT_API_KEY'), commandKey: read('WEBSITE_COMMAND_CENTER_KEY') },
    giftCards: { url: url('GIFT_CARDS_URL'), integrationKey: read('GIFT_CARDS_INTEGRATION_KEY') },
    furniture: {
      supabaseUrl: url('FURNITURE_SUPABASE_URL'),
      supabaseKey: read('FURNITURE_SUPABASE_KEY'),
      appUrl: url('FURNITURE_APP_URL'),
      /** The field app's COMMAND_CENTER_API_KEY: report KPIs + field actions via its /api/command-center. */
      commandKey: read('FURNITURE_COMMAND_CENTER_KEY'),
    },
    designAgent: { url: url('DESIGN_AGENT_URL'), adminToken: read('DESIGN_AGENT_ADMIN_TOKEN') },
    map: {
      siteUrl: url('MAP_SITE_URL') ?? 'https://map.justasecond.co.il',
      repo: read('MAP_GITHUB_REPO') ?? 'Yuval-Steimberg/Interactive-map',
      branch: read('MAP_GITHUB_BRANCH') ?? 'main',
      githubToken: read('GITHUB_TOKEN'),
      /** GA4 Data API: the numeric property id (not the G- measurement id) and a service-account key file. */
      ga4PropertyId: read('MAP_GA4_PROPERTY_ID'),
      ga4ServiceAccount: read('GA4_SERVICE_ACCOUNT_JSON'),
    },
    /**
     * JAS Volunteers: the volunteer app's public URL (links in emails, the QR
     * check-in code) and the sender for emails to volunteers. The tables live
     * in this deployment's own Supabase (migration 0005).
     */
    volunteers: {
      appUrl: url('VOLUNTEER_APP_URL'),
      from: read('VOLUNTEER_EMAIL_FROM') ?? 'Just A Second · מתנדבים <volunteers@justasecond.co.il>',
      replyTo: read('VOLUNTEER_REPLY_TO'),
      teamPhone: read('VOLUNTEER_TEAM_PHONE') ?? '058-787-6549',
    },
    /** Alert and report emails, through SendGrid (justasecond.co.il is domain-authenticated there). Unset = nothing is sent. */
    email: { sendgridKey: read('SENDGRID_API_KEY'), from: read('ALERT_EMAIL_FROM'), cronSecret: read('CRON_SECRET') },
    /** Production deployment status (read-only use; Vercel tokens are scoped per team). */
    vercel: { token: read('VERCEL_TOKEN'), teamId: read('VERCEL_TEAM_ID') },
    /** The read-only AI assistant. Off (and saying so) until the key is set. */
    assistant: { apiKey: read('ANTHROPIC_API_KEY'), workspaceId: read('ANTHROPIC_WORKSPACE_ID'), model: read('ASSISTANT_MODEL') ?? 'claude-opus-5-5' },
    /** Photo → item fields on intake (same key as the assistant; a smaller model is plenty for one photo). */
    photoAi: { model: read('PHOTO_AI_MODEL') ?? 'claude-sonnet-5-5' },
    /**
     * The shop's Grow card terminal (lib/payments/grow-terminal.ts). Off, and saying which variable is
     * missing, until userId + the terminal's dedicated pageCode + a deviceKey + the webhook secret exist.
     */
    growTerminal: {
      apiUrl: url('GROW_API_URL'),
      apiPath: read('GROW_API_PATH'),
      userId: read('GROW_USER_ID') ?? JAS_GROW.userId,
      apiKey: read('GROW_API_KEY'),
      pageCode: read('GROW_TERMINAL_PAGE_CODE') ?? JAS_GROW.pageCode,
      devices: read('GROW_TERMINAL_DEVICES') ?? JAS_GROW.devices,
      webhookSecret: read('GROW_WEBHOOK_SECRET'),
      /** Sent to Grow for a customer without a mobile on file; defaults to the shop's number. */
      phone: read('GROW_TERMINAL_PHONE'),
    },
  }
}

export type Env = ReturnType<typeof env>
