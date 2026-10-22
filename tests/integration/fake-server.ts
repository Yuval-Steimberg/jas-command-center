import http from 'node:http'
import type { AddressInfo } from 'node:net'

export interface Req {
  method: string
  path: string
  headers: http.IncomingHttpHeaders
  body: string
}
export type Handler = (req: Req) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>

/** A local stand-in for a source system's HTTP contract, as the source repo defines it. */
export async function fakeServer(handler: Handler) {
  const seen: Req[] = []
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const r: Req = { method: req.method ?? 'GET', path: req.url ?? '/', headers: req.headers, body: Buffer.concat(chunks).toString() }
    seen.push(r)
    const out = await handler(r)
    res.writeHead(out.status, { 'Content-Type': 'application/json' })
    res.end(typeof out.body === 'string' ? out.body : JSON.stringify(out.body))
  })
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { url, seen, close: () => new Promise<void>((ok) => server.close(() => ok())) }
}

export function resetSourceCache() {
  ;(globalThis as { __ccSourceCache?: Map<string, unknown> }).__ccSourceCache?.clear()
}
