const nf = new Intl.NumberFormat('en-US')
export const formatCount = (n: number | null | undefined) => (n == null ? '—' : nf.format(n))
export const formatPct = (r: number | null | undefined, digits = 1) => (r == null ? '—' : `${(r * 100).toFixed(digits)}%`)

export function formatChange(change: number | null | undefined): string | null {
  if (change == null || !Number.isFinite(change)) return null
  const pct = Math.round(change * 1000) / 10
  return `${pct > 0 ? '+' : ''}${pct}%`
}

export function timeAgo(iso: string | number | null | undefined, now = Date.now()): string {
  if (iso == null) return 'never'
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(t)) return 'unknown'
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function formatDateTime(iso: string | number, lang: 'en' | 'he' = 'en'): string {
  return new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}
