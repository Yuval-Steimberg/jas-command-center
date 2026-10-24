import 'server-only'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'

/** Migration 0006 creates this public bucket in the command center's own Supabase. */
export const PHOTO_BUCKET = 'inventory-photos'
export const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024

/**
 * Store an item photo and return its public https link. Inventory owns the
 * photo (a website listing points at the same link). Without the command
 * center's Supabase (local development) there is nowhere to put it.
 */
export async function uploadInventoryPhoto(bytes: ArrayBuffer, type: string): Promise<string> {
  if (!PHOTO_TYPES.has(type)) throw new Error('Choose a JPEG, PNG or WebP photo.')
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error('The photo is still too large after resizing.')
  if (authMode().kind !== 'supabase') throw new Error('Photo upload needs the command center database. Paste a photo link instead.')
  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg'
  const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`
  const store = supabaseAdmin().storage.from(PHOTO_BUCKET)
  const { error } = await store.upload(path, bytes, { contentType: type, upsert: false })
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error('The photo store does not exist yet. Run supabase/migrations/0006_shop_sales.sql.')
    throw new Error(error.message)
  }
  return store.getPublicUrl(path).data.publicUrl
}
