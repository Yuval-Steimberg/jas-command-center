import { describe, expect, it } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { aiErrorCode, anthropicClient } from '@/lib/anthropic'

const WORKSPACE_BODY = { type: 'error', error: { type: 'invalid_request_error', message: 'This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header with the ID of the workspace to use.' } }

describe('anthropicClient', () => {
  it('sends anthropic-workspace-id only when a workspace is configured', async () => {
    const seen: (string | null)[] = []
    const fetch = async (_url: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers).get('anthropic-workspace-id'))
      return new Response(JSON.stringify(WORKSPACE_BODY), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    for (const workspaceId of ['wrkspc_123', undefined]) {
      const client = anthropicClient({ apiKey: 'k', workspaceId, timeout: 1000 }).withOptions({ fetch, maxRetries: 0 })
      await client.messages.create({ model: 'm', max_tokens: 1, messages: [{ role: 'user', content: 'x' }] }).catch((e) => expect(aiErrorCode(e)).toBe('workspace'))
    }
    expect(seen).toEqual(['wrkspc_123', null])
  })
})

describe('aiErrorCode', () => {
  const err = (status: number, message: string) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'x', message } }, message, new Headers())
  it('names the workspace-scope 400 apart from other 400s', () => {
    expect(aiErrorCode(err(400, WORKSPACE_BODY.error.message))).toBe('workspace')
    expect(aiErrorCode(err(400, 'max_tokens too large'))).toBe('service')
  })
  it('classifies key, rate and connection failures', () => {
    expect(aiErrorCode(err(401, 'invalid x-api-key'))).toBe('key')
    expect(aiErrorCode(err(403, 'forbidden'))).toBe('key')
    expect(aiErrorCode(err(429, 'rate limited'))).toBe('rate')
    expect(aiErrorCode(new Anthropic.APIConnectionTimeoutError())).toBe('timeout')
    expect(aiErrorCode(new Anthropic.APIConnectionError({ message: 'down' }))).toBe('unreachable')
    expect(aiErrorCode(new Error('boom'))).toBe('service')
  })
})
