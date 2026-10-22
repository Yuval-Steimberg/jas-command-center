import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Public liveness probe. Says only that the process answers — no config, no source state. */
export function GET() {
  return NextResponse.json({ ok: true, service: 'jas-command-center', commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null })
}
