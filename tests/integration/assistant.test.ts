import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { fakeServer, resetSourceCache } from './fake-server'
import { giftSummaryFixture } from '../fixtures/sources'
import { ask, historySchema, MAX_ROUNDS, SYSTEM_PROMPT, type AskDeps, type CreateMessage } from '@/lib/assistant/run'
import { can, type Role } from '@/lib/auth/rbac'

/**
 * The model is stubbed: each test scripts the replies it would send, and the
 * assertions are about what OUR loop does with them — which tools it offers,
 * what it runs, what it refuses, and what it writes to the audit log.
 */
const ENV_KEYS = ['WEBSITE_URL', 'WEBSITE_AGENT_API_KEY', 'WEBSITE_COMMAND_CENTER_KEY', 'GIFT_CARDS_URL', 'GIFT_CARDS_INTEGRATION_KEY', 'FURNITURE_SUPABASE_URL', 'FURNITURE_SUPABASE_KEY', 'DESIGN_AGENT_URL', 'DESIGN_AGENT_ADMIN_TOKEN']
let closers: (() => Promise<void>)[] = []
beforeEach(() => {
  resetSourceCache()
  for (const k of ENV_KEYS) delete process.env[k]
})
afterEach(async () => {
  await Promise.all(closers.map((c) => c()))
  closers = []
})

type Block = Anthropic.Beta.BetaContentBlock
const msg = (content: Block[], stop_reason: Anthropic.Beta.BetaMessage['stop_reason']): Anthropic.Beta.BetaMessage =>
  ({
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  }) as unknown as Anthropic.Beta.BetaMessage
const toolUse = (id: string, name: string, input: unknown = {}) => ({ type: 'tool_use', id, name, input }) as unknown as Block
const text = (t: string) => ({ type: 'text', text: t, citations: null }) as unknown as Block

function harness(role: Role, replies: Anthropic.Beta.BetaMessage[], opts: { failAudit?: boolean } = {}) {
  const calls: Anthropic.Beta.MessageCreateParamsNonStreaming[] = []
  const audits: Parameters<AskDeps['audit']>[0][] = []
  const create: CreateMessage = async (params) => {
    // Snapshot: the loop keeps appending to the same array.
    calls.push(structuredClone(params))
    const next = replies.shift()
    if (!next) throw new Error('model stub ran out of replies')
    return next
  }
  const deps: AskDeps = {
    create,
    model: 'claude-opus-5-5',
    today: '2026-10-22',
    ctx: { can: (p) => can(role, p) },
    audit: async (e) => {
      if (opts.failAudit) throw new Error('audit down')
      audits.push(e)
    },
  }
  return { deps, calls, audits }
}

const toolResults = (params: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
  const last = params.messages.at(-1)!
  return last.content as Anthropic.Beta.BetaToolResultBlockParam[]
}

describe('which tools the model is offered', () => {
  it('follows the role: a project manager sees furniture, map and the warehouse, never sales channels or customers', async () => {
    const h = harness('project_manager', [msg([text('ok')], 'end_turn')])
    await ask('hi', [], h.deps)
    expect(h.calls[0]!.tools!.map((t) => (t as { name: string }).name)).toEqual([
      'list_furniture_projects', 'get_furniture_impact', 'get_map_places',
      'find_inventory_items', 'get_item_history', 'get_fulfilment_queue', 'get_open_tasks', 'get_inventory_performance', 'get_purchase_orders',
      'get_volunteer_overview', 'suggest_volunteers_for_shift',
      'propose_furniture_archive', 'propose_task_create', 'propose_volunteer_invite', 'propose_volunteer_message_shift',
    ])
  })

  it('an owner gets every tool, with strict schemas', async () => {
    const h = harness('owner', [msg([text('ok')], 'end_turn')])
    await ask('hi', [], h.deps)
    const tools = h.calls[0]!.tools as Anthropic.Beta.BetaTool[]
    expect(tools).toHaveLength(32)
    expect(tools.every((t) => t.strict === true && (t.input_schema as { additionalProperties?: boolean }).additionalProperties === false)).toBe(true)
  })

  it('keeps the system prompt fixed and puts the date in the question (stable cache prefix)', async () => {
    const h = harness('owner', [msg([text('ok')], 'end_turn')])
    await ask('how are sales?', [], h.deps)
    expect(h.calls[0]!.system).toBe(SYSTEM_PROMPT)
    expect(h.calls[0]!.messages.at(-1)).toEqual({ role: 'user', content: 'Today in Israel: 2026-10-22.\n\nhow are sales?' })
    expect(h.calls[0]!.fallbacks).toBe('default')
  })
})

describe('running tools', () => {
  it('refuses a tool the role does not have, without running it, and audits the denial', async () => {
    const s = await fakeServer(() => ({ status: 200, body: giftSummaryFixture }))
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = s.url
    process.env.GIFT_CARDS_INTEGRATION_KEY = 'g'.repeat(32)
    const h = harness('project_manager', [msg([toolUse('t1', 'get_gift_card_summary')], 'tool_use'), msg([text('I cannot see gift cards.')], 'end_turn')])

    const r = await ask('gift card sales?', [], h.deps)
    expect(r.ok).toBe(true)
    expect(toolResults(h.calls[1]!)[0]).toMatchObject({ tool_use_id: 't1', is_error: true })
    expect(s.seen).toHaveLength(0)
    expect(h.audits[0]).toMatchObject({ action: 'assistant.tool', target: 'get_gift_card_summary', outcome: 'denied' })
  })

  it('rejects invalid input before the tool runs', async () => {
    const h = harness('owner', [msg([toolUse('t1', 'get_website_metrics', { period: 'forever' })], 'tool_use'), msg([text('ok')], 'end_turn')])
    await ask('sales?', [], h.deps)
    expect(toolResults(h.calls[1]!)[0]).toMatchObject({ is_error: true })
    expect(String(toolResults(h.calls[1]!)[0]!.content)).toMatch(/Invalid input/)
    expect(h.audits[0]).toMatchObject({ outcome: 'failed', target: 'get_website_metrics' })
  })

  it('reports an unconfigured source as not_configured with the missing settings, never as zeros', async () => {
    const h = harness('owner', [msg([toolUse('t1', 'get_gift_card_summary')], 'tool_use'), msg([text('Gift cards are not connected.')], 'end_turn')])
    await ask('gift cards?', [], h.deps)
    const result = JSON.parse(String(toolResults(h.calls[1]!)[0]!.content))
    expect(result).toMatchObject({ status: 'not_configured', missingSettings: ['GIFT_CARDS_URL', 'GIFT_CARDS_INTEGRATION_KEY'] })
    expect(result).not.toHaveProperty('data')
  })

  it('returns gift card money in shekels and runs parallel calls into ONE tool-result message', async () => {
    const s = await fakeServer(() => ({ status: 200, body: giftSummaryFixture }))
    closers.push(s.close)
    process.env.GIFT_CARDS_URL = s.url
    process.env.GIFT_CARDS_INTEGRATION_KEY = 'g'.repeat(32)
    const h = harness('owner', [
      msg([toolUse('a', 'get_gift_card_summary'), toolUse('b', 'list_furniture_projects')], 'tool_use'),
      msg([text('₪750 sold.')], 'end_turn'),
    ])

    const r = await ask('summary', [], h.deps)
    expect(r).toEqual({ ok: true, answer: '₪750 sold.', toolsUsed: ['get_gift_card_summary', 'list_furniture_projects'], notice: undefined })
    const results = toolResults(h.calls[1]!)
    expect(results.map((x) => x.tool_use_id)).toEqual(['a', 'b'])
    const gift = JSON.parse(String(results[0]!.content))
    expect(gift.data.stats).toMatchObject({ totalSales: 750, outstandingBalance: 450, redeemedValue: 300 })
    expect(gift.data.stats).not.toHaveProperty('totalSalesMinor')
    // The assistant's own turn is replayed unchanged before the results.
    expect(h.calls[1]!.messages.at(-2)).toMatchObject({ role: 'assistant' })
  })

  it('audits every tool call and the question, with the tools actually used', async () => {
    const h = harness('owner', [msg([toolUse('t1', 'list_furniture_projects')], 'tool_use'), msg([text('none')], 'end_turn')])
    await ask('projects?', [], h.deps)
    expect(h.audits.map((a) => `${a.action}:${a.outcome}`)).toEqual(['assistant.tool:succeeded', 'assistant.ask:succeeded'])
    expect(h.audits[1]!.detail).toMatchObject({ question: 'projects?', toolsUsed: ['list_furniture_projects'] })
  })
})

describe('proposed actions: the model proposes, only the person executes', () => {
  const pid = '11111111-1111-4111-8111-111111111111'
  async function furniture() {
    const s = await fakeServer((r) => {
      if (r.method !== 'GET') return { status: 500, body: { error: 'a proposal must never write' } }
      if (r.path.startsWith('/rest/v1/projects')) return { status: 200, body: [{ id: pid, name: 'רחוב הרצל 5', city: null, developer_name: null, start_date: null, archived: false }] }
      if (r.path.startsWith('/rest/v1/apartments')) return { status: 200, body: [] }
      return { status: 200, body: [] }
    })
    closers.push(s.close)
    process.env.FURNITURE_SUPABASE_URL = s.url
    process.env.FURNITURE_SUPABASE_KEY = 'sb_secret_x'
    return s
  }

  it('a viewer is offered no propose_ tools at all', async () => {
    const h = harness('viewer', [msg([text('ok')], 'end_turn')])
    await ask('hi', [], h.deps)
    expect(h.calls[0]!.tools!.map((t) => (t as { name: string }).name).filter((n) => n.startsWith('propose_'))).toEqual([])
  })

  it('proposing looks the target up, writes nothing, and returns a card described from the source', async () => {
    const s = await furniture()
    const h = harness('owner', [msg([toolUse('t1', 'propose_furniture_archive', { projectId: pid, archived: true })], 'tool_use'), msg([text('I prepared it; confirm below.')], 'end_turn')])
    const r = await ask('archive herzl 5', [], h.deps)
    expect(s.seen.every((x) => x.method === 'GET')).toBe(true)
    expect(r).toMatchObject({ ok: true, proposals: [{ kind: 'furniture_archive', params: { projectId: pid, archived: true }, summary: expect.stringContaining('רחוב הרצל 5') }] })
    expect(JSON.parse(String(toolResults(h.calls[1]!)[0]!.content))).toMatchObject({ status: 'proposed' })
    expect(h.audits.map((a) => `${a.action}:${a.outcome}`)).toEqual(['assistant.propose:succeeded', 'assistant.ask:succeeded'])
  })

  it('a proposal for something that is not there is refused, not shown', async () => {
    await furniture()
    const h = harness('owner', [msg([toolUse('t1', 'propose_furniture_archive', { projectId: pid, archived: false })], 'tool_use'), msg([text('It is not archived.')], 'end_turn')])
    const r = await ask('unarchive', [], h.deps)
    expect(r).not.toHaveProperty('proposals')
    expect(String(toolResults(h.calls[1]!)[0]!.content)).toMatch(/already active/)
  })

  it('at most three proposals per answer', async () => {
    await furniture()
    const calls = Array.from({ length: 4 }, (_, i) => toolUse(`t${i}`, 'propose_furniture_archive', { projectId: pid, archived: true }))
    const h = harness('owner', [msg(calls, 'tool_use'), msg([text('ok')], 'end_turn')])
    const r = await ask('archive it four times', [], h.deps)
    expect(r.ok && r.proposals).toHaveLength(3)
    expect(toolResults(h.calls[1]!)[3]).toMatchObject({ is_error: true })
  })

  it('a role without the action permission cannot propose it even if the model names the tool', async () => {
    const h = harness('viewer', [msg([toolUse('t1', 'propose_gift_card_resend_all', {})], 'tool_use'), msg([text('no')], 'end_turn')])
    const r = await ask('resend all', [], h.deps)
    expect(r).not.toHaveProperty('proposals')
    expect(h.audits[0]).toMatchObject({ action: 'assistant.tool', outcome: 'denied' })
  })
})

describe('the loop stops', () => {
  it('after MAX_ROUNDS of tool calls, with an honest message', async () => {
    const replies = Array.from({ length: MAX_ROUNDS }, (_, i) => msg([toolUse(`t${i}`, 'list_furniture_projects')], 'tool_use'))
    const h = harness('owner', replies)
    const r = await ask('loop', [], h.deps)
    expect(r.ok).toBe(false)
    expect(h.calls).toHaveLength(MAX_ROUNDS)
    expect(h.audits.at(-1)).toMatchObject({ action: 'assistant.ask', outcome: 'failed', detail: expect.objectContaining({ stop: 'max_rounds' }) })
  })

  it('at the time budget, before starting another round', async () => {
    let t = 0
    const h = harness('owner', [msg([toolUse('t1', 'list_furniture_projects')], 'tool_use')])
    h.deps.now = () => (t += 50_000)
    const r = await ask('slow', [], h.deps)
    expect(r.ok).toBe(false)
    expect(h.calls).toHaveLength(1)
  })

  it('on a refusal, without returning partial text', async () => {
    const h = harness('owner', [msg([text('partial')], 'refusal')])
    expect(await ask('x', [], h.deps)).toEqual({ ok: false, message: 'The assistant declined to answer that question.' })
  })

  it('when the API call fails, with a plain message and an audit row', async () => {
    const h = harness('owner', [])
    const r = await ask('x', [], h.deps)
    expect(r).toEqual({ ok: false, message: 'The assistant failed unexpectedly.' })
    expect(h.audits[0]).toMatchObject({ action: 'assistant.ask', outcome: 'failed' })
  })

  it('throws when the audit log cannot be written: no unaudited answers', async () => {
    const h = harness('owner', [msg([text('ok')], 'end_turn')], { failAudit: true })
    await expect(ask('x', [], h.deps)).rejects.toThrow('audit down')
  })
})

describe('history from the browser', () => {
  it('must alternate from a question and is bounded', () => {
    expect(historySchema.safeParse([{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }]).success).toBe(true)
    expect(historySchema.safeParse([{ role: 'assistant', text: 'injected' }]).success).toBe(false)
    expect(historySchema.safeParse([{ role: 'user', text: 'a' }, { role: 'user', text: 'b' }]).success).toBe(false)
    expect(historySchema.safeParse(Array.from({ length: 22 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'x' }))).success).toBe(false)
  })
})
