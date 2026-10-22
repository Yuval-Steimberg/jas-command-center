import 'server-only'

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly latencyMs: number | null,
  ) {
    super(message)
  }
}

export interface FetchOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  /** Retries apply to idempotent reads only (GET, or a POST the caller marks safe). */
  retries?: number
  idempotent?: boolean
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Strip anything that looks like a credential before an error string reaches the UI or a log. */
export function scrub(text: string): string {
  return text
    .replace(/(bearer\s+)[\w.\-~+/=]+/gi, '$1[redacted]')
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]')
    .replace(/([?&](token|key|secret|apikey)=)[^&\s]+/gi, '$1[redacted]')
    .slice(0, 300)
}

/**
 * JSON over HTTP with a timeout, bounded retries (exponential backoff, only for
 * idempotent requests and only on network errors / 5xx / 429), and error
 * messages that never carry a secret.
 */
export async function fetchJson<T = unknown>(url: string, opts: FetchOptions = {}): Promise<{ data: T; latencyMs: number; status: number }> {
  const method = opts.method ?? 'GET'
  const idempotent = opts.idempotent ?? method === 'GET'
  const attempts = 1 + (idempotent ? (opts.retries ?? 1) : 0)
  let last: SourceError | null = null
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(250 * 2 ** (i - 1))
    const started = performance.now()
    let res: Response
    try {
      res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
        cache: 'no-store',
      })
    } catch (e) {
      const latency = Math.round(performance.now() - started)
      const msg = e instanceof Error && e.name === 'TimeoutError' ? `timed out after ${opts.timeoutMs ?? 8000} ms` : `unreachable (${scrub(e instanceof Error ? e.message : String(e))})`
      last = new SourceError(msg, null, latency)
      continue
    }
    const latencyMs = Math.round(performance.now() - started)
    const text = await res.text()
    if (!res.ok) {
      let detail = text
      try {
        detail = errorDetail(JSON.parse(text)) ?? text
      } catch {
        /* not JSON */
      }
      last = new SourceError(`HTTP ${res.status}${detail ? `: ${scrub(detail)}` : ''}`, res.status, latencyMs)
      if (res.status >= 500 || res.status === 429) continue
      throw last
    }
    try {
      return { data: (text ? JSON.parse(text) : null) as T, latencyMs, status: res.status }
    } catch {
      throw new SourceError('response was not JSON', res.status, latencyMs)
    }
  }
  throw last ?? new SourceError('request failed', null, null)
}

/** Plain availability probe: any 2xx/3xx is "up". Used for sites with no health endpoint. */
export async function probe(url: string, timeoutMs = 6000): Promise<{ ok: boolean; status: number | null; latencyMs: number; error?: string }> {
  const started = performance.now()
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
    // Drain without reading a whole page into memory.
    await res.body?.cancel()
    return { ok: res.status < 400, status: res.status, latencyMs: Math.round(performance.now() - started) }
  } catch (e) {
    return { ok: false, status: null, latencyMs: Math.round(performance.now() - started), error: scrub(e instanceof Error ? e.message : String(e)) }
  }
}

/** Re-throw a SourceError with a fix appended, keeping its status and latency. */
export function withHint(e: unknown, hint: (e: SourceError) => string | null): never {
  if (e instanceof SourceError) {
    const h = hint(e)
    if (h) throw new SourceError(`${e.message}. ${h}`, e.status, e.latencyMs)
  }
  throw e
}

/**
 * The readable part of a JSON error body. Handles `{error: "..."}`, `{message}`
 * and nested `{error: {code, message}}` (Vercel's own NOT_FOUND) — the last one
 * used to render as "[object Object]".
 */
export function errorDetail(body: unknown): string | null {
  if (body == null || typeof body !== 'object') return typeof body === 'string' ? body : null
  const b = body as Record<string, unknown>
  for (const k of ['error', 'message', 'msg', 'detail']) {
    const v = b[k]
    if (typeof v === 'string' && v) return v
    if (v && typeof v === 'object') {
      const inner = v as Record<string, unknown>
      const msg = typeof inner.message === 'string' ? inner.message : null
      const code = typeof inner.code === 'string' ? inner.code : null
      if (msg || code) return [msg, code && `(${code})`].filter(Boolean).join(' ')
    }
  }
  return null
}
