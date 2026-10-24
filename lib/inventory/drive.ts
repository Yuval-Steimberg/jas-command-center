/**
 * Photos linked from Google Drive (the jas-inventory import stored
 * `drive.google.com/thumbnail?id=…` links). A browser cannot be relied on to
 * show those: Safari answered them with a broken image even once the folder
 * was shared publicly. So they are copied into the command center's own photo
 * store once, server-side, and the item points at that copy. Pure; tested in
 * tests/unit/ops-models.test.ts.
 */

/** The Drive file id in a thumbnail, open, uc or /file/d/ link; null for anything else. */
export function driveFileId(url: string | null | undefined): string | null {
  if (!url) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (!/(^|\.)drive\.google\.com$|^drive\.usercontent\.google\.com$/.test(u.hostname)) return null
  const id = u.searchParams.get('id') ?? /\/file\/d\/([\w-]+)/.exec(u.pathname)?.[1] ?? null
  return id && /^[\w-]{10,}$/.test(id) ? id : null
}

/** Where to fetch the file from a server, best first: a resized JPEG, then the original. */
export const driveDownloadUrls = (id: string) => [
  `https://drive.google.com/thumbnail?id=${id}&sz=w1600`,
  `https://drive.usercontent.google.com/download?id=${id}&export=download`,
]
