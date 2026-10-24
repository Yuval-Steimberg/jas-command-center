import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import { env } from '@/lib/env'
import { parsePhotoFields, PHOTO_FIELDS_SCHEMA, PHOTO_PROMPT, type PhotoFields } from './ai-fields'

export type { PhotoFields } from './ai-fields'

/**
 * One photo → suggested item fields (name, category, colours, material, a
 * short Hebrew description, a price estimate). One call per photo, server
 * side; the key never reaches the browser. Everything it returns is a
 * suggestion a person reviews before saving, and the price stays marked as an
 * estimate until someone approves it.
 */
export async function describePhoto(image: ArrayBuffer, mediaType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<{ ok: true; fields: PhotoFields } | { ok: false; message: string }> {
  const e = env()
  if (!e.assistant.apiKey) return { ok: false, message: 'AI is not set up: ANTHROPIC_API_KEY is missing on the deployment. Fill the fields by hand.' }
  const client = new Anthropic({ apiKey: e.assistant.apiKey, timeout: 45_000, maxRetries: 1 })
  try {
    const res = await client.messages.create({
      model: e.photoAi.model,
      max_tokens: 1500,
      system: PHOTO_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(image).toString('base64') } },
            { type: 'text', text: 'Describe this piece for the shop inventory.' },
          ],
        },
      ],
      output_config: { format: { type: 'json_schema', schema: PHOTO_FIELDS_SCHEMA } },
    })
    if (res.stop_reason === 'refusal') return { ok: false, message: 'The AI declined this photo. Fill the fields by hand.' }
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const fields = parsePhotoFields(text)
    return fields ? { ok: true, fields } : { ok: false, message: 'The AI answer could not be read. Fill the fields by hand.' }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return { ok: false, message: 'The AI key was rejected. Check ANTHROPIC_API_KEY on the deployment.' }
    return { ok: false, message: `The AI could not be reached (${err instanceof Error ? err.message : String(err)}). Fill the fields by hand.` }
  }
}
