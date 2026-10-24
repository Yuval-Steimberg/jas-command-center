import type {
  Contact, ContactInput, ContactRole, Deal, DealInput, DealStage, Delivery, DeliveryInput, DeliveryStatus, Interaction, InteractionInput,
  Item, ItemPatch, ItemStatus, Location, Movement, MovementInput, NewItem, Task, TaskInput,
} from './types'

/** A write refused because the record is not in the state the caller expected. An answer to show, never an outage. */
export class ConflictError extends Error {
  readonly conflict = true
}

/** Migration 0003 has not been run on the command center database. */
export class OpsSetupError extends Error {
  constructor(readonly migration = '0003_crm_inventory.sql', what = 'The customer and inventory tables') {
    super(`${what} do not exist yet. Run supabase/migrations/${migration} in the command center Supabase SQL editor.`)
  }
}

export interface ItemFilter {
  statuses?: readonly ItemStatus[]
  q?: string
  locationId?: string
  ids?: readonly string[]
  websiteProductIds?: readonly number[]
  furnitureItemIds?: readonly string[]
  buyerContactId?: string
  reservedFor?: string
  createdSince?: string
  limit?: number
}

export interface ContactFilter {
  q?: string
  role?: ContactRole
  ids?: readonly string[]
  limit?: number
}

/**
 * Persistence for the operational modules. `getOpsStore()` (./index) returns
 * the Supabase implementation in production and an in-memory one for local
 * development, with identical semantics: `applyItem` is atomic (row lock in
 * Postgres, no await between check and write in memory), checks the expected
 * status/version, appends exactly one movement, and replays idempotently when a
 * movement with the same ref was already recorded.
 */
export interface OpsStore {
  readonly kind: 'memory' | 'supabase'

  listLocations(): Promise<Location[]>
  saveLocation(input: Pick<Location, 'name' | 'kind'> & Partial<Pick<Location, 'parentId' | 'address' | 'notes' | 'active'>>, id?: string): Promise<Location>

  listItems(filter?: ItemFilter): Promise<Item[]>
  getItem(id: string): Promise<Item | null>
  getItemBySku(sku: string): Promise<Item | null>
  createItem(item: NewItem, movement: Omit<MovementInput, 'type'>): Promise<Item>
  applyItem(id: string, expect: { version?: number; from?: readonly ItemStatus[] }, set: ItemPatch, movement: MovementInput): Promise<Item>
  /** Every item with a photo hash (migration 0006), for the duplicate-photo warning. Paged past the row cap. */
  photoHashes(): Promise<Pick<Item, 'id' | 'sku' | 'title' | 'photoUrl' | 'status' | 'photoHash'>[]>
  movements(itemId: string): Promise<Movement[]>
  recentMovements(limit: number, since?: string): Promise<Movement[]>

  listContacts(filter?: ContactFilter): Promise<Contact[]>
  getContact(id: string): Promise<Contact | null>
  findContact(email: string | null, phone: string | null): Promise<Contact | null>
  createContact(input: ContactInput): Promise<Contact>
  updateContact(id: string, patch: Partial<ContactInput>): Promise<Contact>

  listDeals(filter?: { stages?: readonly DealStage[]; contactId?: string; limit?: number }): Promise<Deal[]>
  getDeal(id: string): Promise<Deal | null>
  /** Creates the deal; with a sourceRef that already exists, returns the existing one and created=false. */
  createDeal(input: DealInput): Promise<{ deal: Deal; created: boolean }>
  updateDeal(id: string, patch: Partial<DealInput>): Promise<Deal>

  listInteractions(filter: { contactId?: string; since?: string; limit?: number }): Promise<Interaction[]>
  /** Idempotent by (contact, refKind, refId). */
  addInteraction(input: InteractionInput): Promise<{ interaction: Interaction; created: boolean }>

  listTasks(filter?: { status?: Task['status']; entityKind?: string; entityId?: string; assignee?: string; limit?: number }): Promise<Task[]>
  /** Idempotent by dedupeKey. */
  createTask(input: TaskInput): Promise<{ task: Task; created: boolean }>
  setTaskStatus(id: string, status: Task['status'], by: string): Promise<Task | null>

  listDeliveries(filter?: { statuses?: readonly DeliveryStatus[]; websiteOrderId?: number; itemId?: string; saleLineIds?: readonly string[]; limit?: number }): Promise<Delivery[]>
  getDelivery(id: string): Promise<Delivery | null>
  createDelivery(input: DeliveryInput): Promise<Delivery>
  /** Conditional on the current status, so two people cannot both close one delivery. */
  updateDelivery(id: string, expectStatus: DeliveryStatus, patch: Partial<Omit<DeliveryInput, 'createdBy'>>): Promise<Delivery | null>

  ruleSettings(): Promise<Map<string, boolean>>
  setRule(id: string, enabled: boolean, by: string): Promise<void>

  getCursor(key: string): Promise<{ cursor: string | null; lastSuccessAt: string | null; lastError: string | null }>
  setCursor(key: string, value: { cursor?: string | null; ok: boolean; error?: string | null }): Promise<void>
}
