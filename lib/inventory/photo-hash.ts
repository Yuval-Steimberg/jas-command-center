/**
 * Duplicate-photo warning. A 64-bit difference hash: shrink the photo to 9×8
 * grey pixels and record, for each row, whether each pixel is brighter than
 * its right-hand neighbour. Two shots of the same piece differ in a few bits;
 * different pieces in about half of them. Pure, so the browser computes it on
 * the photo before upload and the server compares it, and tests pin both.
 *
 * It only ever WARNS: one-of-a-kind items can look alike, and a person decides.
 */

export const HASH_W = 9
export const HASH_H = 8
/** Bits that may differ for two photos to count as "probably the same piece". */
export const DUPLICATE_THRESHOLD = 10

/** `grey` is HASH_W × HASH_H luminance values, row by row. Returns 16 hex characters. */
export function differenceHash(grey: ArrayLike<number>): string {
  if (grey.length !== HASH_W * HASH_H) throw new Error(`expected ${HASH_W * HASH_H} pixels`)
  let hex = ''
  let nibble = 0
  let n = 0
  for (let y = 0; y < HASH_H; y++) {
    for (let x = 0; x < HASH_W - 1; x++) {
      nibble = (nibble << 1) | (grey[y * HASH_W + x]! > grey[y * HASH_W + x + 1]! ? 1 : 0)
      if (++n % 4 === 0) {
        hex += nibble.toString(16)
        nibble = 0
      }
    }
  }
  return hex
}

/** RGBA pixels (canvas ImageData) → luminance. */
export function toGrey(rgba: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 0; i + 3 < rgba.length; i += 4) out.push(0.299 * rgba[i]! + 0.587 * rgba[i + 1]! + 0.114 * rgba[i + 2]!)
  return out
}

export const isPhotoHash = (h: unknown): h is string => typeof h === 'string' && /^[0-9a-f]{16}$/.test(h)

export function hammingDistance(a: string, b: string): number {
  if (!isPhotoHash(a) || !isPhotoHash(b)) return 64
  let d = 0
  for (let i = 0; i < 16; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)
    while (x) {
      d += x & 1
      x >>= 1
    }
  }
  return d
}

/** Items whose photo is within the threshold, closest first. */
export function similarPhotos<T extends { photoHash?: string | null }>(hash: string, items: T[], threshold = DUPLICATE_THRESHOLD): (T & { distance: number })[] {
  if (!isPhotoHash(hash)) return []
  return items
    .filter((i) => isPhotoHash(i.photoHash))
    .map((i) => ({ ...i, distance: hammingDistance(hash, i.photoHash!) }))
    .filter((i) => i.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
}
