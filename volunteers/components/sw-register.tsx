'use client'

import { useEffect } from 'react'

/** Installs the service worker (offline page only). Silent when unsupported. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }, [])
  return null
}
