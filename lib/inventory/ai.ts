import 'server-only'
import { aiErrorCode, anthropicClient, type AiErrorCode } from '@/lib/anthropic'
import { env } from '@/lib/env'
import { parsePhotoFields, PHOTO_FIELDS_SCHEMA, PHOTO_PROMPT, type PhotoFields } from './ai-fields'

export type { PhotoFields } from './ai-fields'

/** Why a photo could not be read. The form turns the code into its own language; `message` is English, for the audit log. */
export type PhotoAiError = AiErrorCode | 'not_configured' | 'refused' | 'unreadable'

/**
 * One photo → suggested item fields (name, category, colours, material, a
 * short Hebrew description, a price estimate). One call per photo, server
 * side; the key never reaches the browser. Everything it returns is a
 * suggestion a person reviews before saving, and the price stays marked as an
 * estimate until someone approves it.
 */
export async function describePhoto(image: ArrayBuffer, mediaType: 'image/jpeg' | 'image/png' | 'image/webp'): Promise<{ ok: true; fields: PhotoFields } | { ok: false; code: PhotoAiError; message: string }> {
  const e = env()
  if (!e.assistant.apiKey) return { ok: false, code: 'not_configured', message: 'ANTHROPIC_API_KEY is missing on the deployment.' }
  const client = anthropicClient({ apiKey: e.assistant.apiKey, workspaceId: e.assistant.workspaceId, timeout: 45_000 })
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
    if (res.stop_reason === 'refusal') return { ok: false, code: 'refused', message: 'The AI declined this photo.' }
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
    const fields = parsePhotoFields(text)
    return fields ? { ok: true, fields } : { ok: false, code: 'unreadable', message: 'The AI answer could not be parsed.' }
  } catch (err) {
    // The raw error (which can be a JSON body) goes to the audit log only.
    return { ok: false, code: aiErrorCode(err), message: err instanceof Error ? err.message : String(err) }
  }
}
