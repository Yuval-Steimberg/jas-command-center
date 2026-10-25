import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { authMode } from '@/lib/auth/mode'
import { supabaseAdmin } from '@/lib/supabase'
import { OpsSetupError } from '@/lib/ops/store'
import { emptyData, type MemoryData } from '@/lib/ops/memory'
import { fail, fromRow, toRow, type PgError, type Row } from '@/lib/ops/supabase'
import type { TerminalCharge, TerminalStatus } from './model'

/** Migration 0007 has not been run. */
export const terminalSetupError = () => new OpsSetupError('0007_terminal_charges.sql', 'The card terminal table')

export type ChargePatch = Partial<Pick<TerminalCharge, 'status' | 'url' | 'processId' | 'transactionId' | 'asmachta' | 'cardSuffix' | 'paidMinor' | 'paymentId' | 'approvedAt' | 'approveError' | 'error' | 'raw'>>

/**
 * Grow terminal charges. `create` replays by request id; `update` is
 * conditional on the current status, so two server updates (Grow's per-request
 * notify and the account webhook) can never both move one charge.
 */
export interface TerminalStore {
  create(c: Pick<TerminalCharge, 'saleId' | 'amountMinor' | 'device' | 'requestId' | 'createdBy'>): Promise<{ charge: TerminalCharge; replay: boolean }>
  get(id: string): Promise<TerminalCharge | null>
  byProcessId(processId: string): Promise<TerminalCharge | null>
  forSale(saleId: string): Promise<TerminalCharge[]>
  update(id: string, from: readonly TerminalStatus[], patch: ChargePatch): Promise<TerminalCharge | null>
}

const g = globalThis as unknown as { __ccOpsData?: MemoryData }

export function getTerminalStore(): TerminalStore {
  if (authMode().kind === 'supabase') return supabaseTerminalStore(supabaseAdmin())
  return memoryTerminalStore((g.__ccOpsData ??= emptyData()))
}

const now = () => new Date().toISOString()
const copy = <T>(x: T): T => structuredClone(x)

export function memoryTerminalStore(d: MemoryData): TerminalStore {
  return {
    async create(c) {
      const prior = d.terminalCharges.find((x) => x.requestId === c.requestId)
      if (prior) return { charge: copy(prior), replay: true }
      const t = now()
      const charge: TerminalCharge = {
        id: crypto.randomUUID(), ...c, status: 'sent', url: null, processId: null, transactionId: null, asmachta: null, cardSuffix: null,
        paidMinor: null, paymentId: null, approvedAt: null, approveError: null, error: null, raw: null, createdAt: t, updatedAt: t,
      }
      d.terminalCharges.push(charge)
      return { charge: copy(charge), replay: false }
    },
    async get(id) {
      return copy(d.terminalCharges.find((x) => x.id === id) ?? null)
    },
    async byProcessId(pid) {
      return copy(d.terminalCharges.find((x) => x.processId === pid) ?? null)
    },
    async forSale(saleId) {
      return copy(d.terminalCharges.filter((x) => x.saleId === saleId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    },
    async update(id, from, patch) {
      const c = d.terminalCharges.find((x) => x.id === id && from.includes(x.status))
      if (!c) return null
      Object.assign(c, patch, { updatedAt: now() })
      return copy(c)
    },
  }
}

export function supabaseTerminalStore(db: SupabaseClient): TerminalStore {
  async function rows(p: PromiseLike<{ data: unknown; error: PgError }>): Promise<TerminalCharge[]> {
    const { data, error } = await p
    if (error) fail(error, terminalSetupError)
    return ((data ?? []) as Row[]).map((r) => fromRow<TerminalCharge>(r))
  }
  const one = async (p: PromiseLike<{ data: unknown; error: PgError }>) => (await rows(p))[0] ?? null
  const t = () => db.from('cc_terminal_charges')
  return {
    async create(c) {
      const before = await one(t().select('*').eq('request_id', c.requestId).limit(1))
      if (before) return { charge: before, replay: true }
      const r = await one(t().insert(toRow({ ...c, status: 'sent' })).select('*'))
      if (!r) throw new Error('The charge was saved but could not be read back.')
      return { charge: r, replay: false }
    },
    get: (id) => one(t().select('*').eq('id', id).limit(1)),
    byProcessId: (pid) => one(t().select('*').eq('process_id', pid).limit(1)),
    forSale: (saleId) => rows(t().select('*').eq('sale_id', saleId).order('created_at', { ascending: false }).limit(50)),
    update: (id, from, patch) => one(t().update({ ...toRow(patch), updated_at: now() }).eq('id', id).in('status', [...from]).select('*')),
  }
}
