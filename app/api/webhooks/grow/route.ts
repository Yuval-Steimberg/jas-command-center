import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { receiveServerUpdate } from '@/lib/sales/terminal'

export const dynamic = 'force-dynamic'

/**
 * Grow's server update for the shop terminal. Outside sign-in (middleware
 * matcher); locked by GROW_WEBHOOK_SECRET in `?token=`. Not configured = 404.
 * A sale's page polls, so the payment shows on the counter phone within seconds.
 */
export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get('token')
  try {
    const out = await receiveServerUpdate(await req.text(), req.headers.get('content-type') ?? '', token)
    if (out.status === 200) for (const p of ['/sales', '/shop']) revalidatePath(p, 'layout')
    return NextResponse.json(out.body, { status: out.status })
  } catch (e) {
    console.error('grow webhook:', e instanceof Error ? e.message : e)
    // 500 so Grow retries: the payment write is idempotent by transaction id.
    return NextResponse.json({ error: 'not recorded' }, { status: 500 })
  }
}
