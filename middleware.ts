import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Keeps the Supabase session cookie fresh and sends signed-out visitors to
 * /login. This is convenience, NOT authorization: every page, action and route
 * verifies the session and the permission itself.
 */
export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  let res = NextResponse.next({ request: req })
  let signedIn = Boolean(req.cookies.get('cc_dev_session')?.value)
  if (url && anon) {
    try {
      signedIn = await refreshSupabaseSession(req, url, anon, (r) => (res = r))
    } catch (e) {
      // A malformed URL or key must not take every route down: treat the visitor
      // as signed out, and /login explains what is wrong with the setup.
      console.error('middleware: Supabase session check failed:', e instanceof Error ? e.message : e)
      signedIn = false
    }
  }
  if (!signedIn && !req.nextUrl.pathname.startsWith('/login')) {
    const to = req.nextUrl.clone()
    to.pathname = '/login'
    to.search = ''
    return NextResponse.redirect(to)
  }
  return res
}

async function refreshSupabaseSession(req: NextRequest, url: string, anon: string, setRes: (r: NextResponse) => void): Promise<boolean> {
  const supabase = createServerClient(url.trim(), anon.trim(), {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) req.cookies.set(name, value)
          const res = NextResponse.next({ request: req })
          for (const { name, value, options } of list) res.cookies.set(name, value, options)
          setRes(res)
        },
      },
    })
  const { data } = await supabase.auth.getUser()
  return Boolean(data.user)
}

export const config = {
  // Everything except static assets, the public liveness probe and the cron routes (Bearer CRON_SECRET).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health|api/cron).*)'],
}
