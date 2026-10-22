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
    const supabase = createServerClient(url, anon, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) req.cookies.set(name, value)
          res = NextResponse.next({ request: req })
          for (const { name, value, options } of list) res.cookies.set(name, value, options)
        },
      },
    })
    const { data } = await supabase.auth.getUser()
    signedIn = Boolean(data.user)
  }
  if (!signedIn && !req.nextUrl.pathname.startsWith('/login')) {
    const to = req.nextUrl.clone()
    to.pathname = '/login'
    to.search = ''
    return NextResponse.redirect(to)
  }
  return res
}

export const config = {
  // Everything except static assets and the public liveness probe.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/health).*)'],
}
