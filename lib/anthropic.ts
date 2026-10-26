import Anthropic from '@anthropic-ai/sdk'

/**
 * The one way this app builds an Anthropic client. An organisation-level key
 * (one not created inside a workspace) is refused with a 400 unless every
 * request names a workspace, so ANTHROPIC_WORKSPACE_ID, when set, is sent as
 * the `anthropic-workspace-id` header. A workspace-scoped key needs nothing.
 */
export function anthropicClient(o: { apiKey: string; workspaceId?: string; timeout: number }): Anthropic {
  return new Anthropic({
    apiKey: o.apiKey,
    timeout: o.timeout,
    maxRetries: 1,
    ...(o.workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': o.workspaceId } } : {}),
  })
}

export type AiErrorCode = 'workspace' | 'key' | 'rate' | 'timeout' | 'unreachable' | 'service'

/** Classifies an SDK error without exposing its body (raw JSON never reaches a screen). */
export function aiErrorCode(e: unknown): AiErrorCode {
  if (e instanceof Anthropic.BadRequestError && /workspace/i.test(e.message)) return 'workspace'
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'key'
  if (e instanceof Anthropic.RateLimitError) return 'rate'
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'timeout'
  if (e instanceof Anthropic.APIConnectionError) return 'unreachable'
  return 'service'
}
