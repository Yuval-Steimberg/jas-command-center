'use client'

import { useEffect } from 'react'
import { authLinkTarget } from '@/lib/auth/auth-link'

/**
 * An invitation or password-reset link that landed on the wrong page (Supabase
 * fell back to its Site URL) is forwarded to /login/set-password with its
 * fragment, instead of silently showing the sign-in form.
 */
export function AuthLinkForwarder() {
  useEffect(() => {
    const to = authLinkTarget(window.location.pathname, window.location.hash)
    if (to) window.location.replace(to)
  }, [])
  return null
}
