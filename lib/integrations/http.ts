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
        const j = JSON.parse(text) as { error?: unknown; message?: unknown }
        detail = String(j.error ?? j.message ?? text)
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
