import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // The business rules live in ../lib/volunteers, shared with the Command Center.
    externalDir: true,
    staleTimes: { dynamic: 0 },
  },
  webpack(config) {
    // ../lib/** imports npm packages; resolve them from THIS app's node_modules
    // (Vercel installs only volunteers/package.json when the root directory is volunteers/).
    config.resolve.modules = [path.join(here, 'node_modules'), 'node_modules']
    return config
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache' }, { key: 'Service-Worker-Allowed', value: '/' }] },
    ]
  },
}

export default nextConfig
