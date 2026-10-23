import 'server-only'
import { env } from '@/lib/env'

/**
 * One email through SendGrid's v3 API. justasecond.co.il is already
 * domain-authenticated there (the gift card system sends through it), so a
 * From on that domain is accepted without new DNS records.
 *
 * Returns what SendGrid said. A 202 is "accepted", not "delivered".
 * Never retried here: the callers record what was sent, and a retry after a
 * timeout could send twice.
 */
export type SendResult = { ok: true } | { ok: false; error: string }

export function emailConfigured(): boolean {
  const e = env().email
  return Boolean(e.sendgridKey && e.from)
}

export async function sendEmail(to: string, subject: string, text: string): Promise<SendResult> {
  const { sendgridKey, from } = env().email
  if (!sendgridKey || !from) return { ok: false, error: 'not configured (SENDGRID_API_KEY, ALERT_EMAIL_FROM)' }
  const m = /^(.*)<([^>]+)>\s*$/.exec(from)
  const sender = m ? { email: m[2]!.trim(), name: m[1]!.trim().replace(/^"|"$/g, '') || undefined } : { email: from.trim() }
  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sendgridKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: sender,
        subject: subject.slice(0, 200),
        content: [{ type: 'text/plain', value: text }],
        // Internal mail: no click rewriting of console links.
        tracking_settings: { click_tracking: { enable: false }, open_tracking: { enable: false } },
      }),
      signal: AbortSignal.timeout(15_000),
      cache: 'no-store',
    })
    if (res.status === 202 || res.ok) return { ok: true }
    const body = (await res.text()).slice(0, 300)
    return { ok: false, error: `SendGrid HTTP ${res.status}${body ? `: ${body}` : ''}` }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
