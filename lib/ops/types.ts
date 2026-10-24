/**
 * The command center's own operational records (migration 0003): inventory
 * after intake, contacts and leads, tasks and deliveries. Website orders, gift
 * cards and field records are never stored here: rows point at them by id.
 */

export const ITEM_STATUSES = ['in_storage', 'listed', 'reserved', 'sold', 'delivered', 'donated', 'recycled', 'disposed'] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]

export const CONDITIONS = ['as_new', 'good', 'needs_repair', 'scrap_only'] as const
export type Condition = (typeof CONDITIONS)[number]

export const LOCATION_KINDS = ['warehouse', 'zone', 'shelf', 'shop', 'external'] as const
export type LocationKind = (typeof LOCATION_KINDS)[number]

export const MOVEMENT_TYPES = ['intake', 'move', 'edit', 'list', 'publish', 'unpublish', 'reserve', 'release', 'sell', 'deliver', 'return', 'donate', 'recycle', 'dispose', 'adjust', 'conflict'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export interface Location {
  id: string
  name: string
  kind: LocationKind
  parentId: string | null
  address: string | null
  notes: string | null
  active: boolean
  createdAt: string
}

export interface Item {
  id: string
  sku: string
  title: string
  description: string | null
  category: string | null
  kind: 'unique' | 'batch'
  quantity: number
  condition: Condition | null
  status: ItemStatus
  locationId: string | null
  priceMinor: number | null
  photoUrl: string | null
  dimensions: string | null
  material: string | null
  weightKg: number | null
  source: 'furniture' | 'manual' | 'purchase'
  furnitureItemId: string | null
  furnitureProjectId: string | null
  furnitureProjectName: string | null
  furnitureApartment: string | null
  websiteProductId: number | null
  reservedFor: string | null
  reservedUntil: string | null
  reservedPrevStatus: ItemStatus | null
  reservedWebsiteQty: number | null
  soldChannel: 'website' | 'in_store' | null
  soldAt: string | null
  soldPriceMinor: number | null
  buyerContactId: string | null
  websiteOrderId: number | null
  websiteOrderNumber: string | null
  dispositionNote: string | null
  /** Bought from a supplier (migration 0004); never changed after intake. */
  purchaseOrderId?: string | null
  supplierId?: string | null
  unitCostMinor?: number | null
  version: number
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** Fields a write may set (never id, sku, version, source, furniture link or timestamps). */
export type ItemPatch = Partial<Omit<Item, 'id' | 'sku' | 'version' | 'source' | 'furnitureItemId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'purchaseOrderId' | 'supplierId' | 'unitCostMinor'>>
export type NewItem = ItemPatch & Pick<Item, 'title'> & Partial<Pick<Item, 'source' | 'furnitureItemId' | 'createdBy' | 'purchaseOrderId' | 'supplierId' | 'unitCostMinor'>>

export interface Movement {
  id: string
  itemId: string
  at: string
  type: MovementType
  fromStatus: ItemStatus | null
  toStatus: ItemStatus | null
  fromLocation: string | null
  toLocation: string | null
  quantityDelta: number
  refKind: string | null
  refId: string | null
  note: string | null
  actorEmail: string
  detail: Record<string, unknown>
}

export interface MovementInput {
  type: MovementType
  refKind?: string | null
  refId?: string | null
  note?: string | null
  actorEmail: string
  quantityDelta?: number
  detail?: Record<string, unknown>
}

export const CONTACT_ROLES = ['customer', 'lead', 'supplier', 'partner', 'donor', 'volunteer'] as const
export type ContactRole = (typeof CONTACT_ROLES)[number]
export const CONTACT_SOURCES = ['manual', 'website_order', 'website_form', 'gift_card', 'whatsapp', 'in_store', 'volunteer_app'] as const

export interface Contact {
  id: string
  kind: 'person' | 'company'
  fullName: string
  email: string | null
  phone: string | null
  companyId: string | null
  roles: ContactRole[]
  source: string
  notes: string | null
  ownerProfileId: string | null
  createdAt: string
  updatedAt: string
}
export type ContactInput = Pick<Contact, 'fullName'> & Partial<Omit<Contact, 'id' | 'createdAt' | 'updatedAt' | 'fullName'>>

export const DEAL_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'] as const
export type DealStage = (typeof DEAL_STAGES)[number]

export interface Deal {
  id: string
  contactId: string
  title: string
  stage: DealStage
  valueMinor: number | null
  itemId: string | null
  source: string
  sourceRef: string | null
  nextStep: string | null
  nextStepAt: string | null
  ownerProfileId: string | null
  lastContactedAt: string | null
  closedAt: string | null
  createdAt: string
  updatedAt: string
}
export type DealInput = Pick<Deal, 'contactId' | 'title'> & Partial<Omit<Deal, 'id' | 'createdAt' | 'updatedAt' | 'contactId' | 'title'>>

export const CHANNELS = ['whatsapp', 'phone', 'email', 'in_person', 'website_form', 'website_order', 'gift_card', 'note'] as const
export type Channel = (typeof CHANNELS)[number]

export interface Interaction {
  id: string
  contactId: string
  at: string
  channel: Channel
  direction: 'in' | 'out' | 'none'
  summary: string
  refKind: string | null
  refId: string | null
  actorEmail: string
}
export type InteractionInput = Omit<Interaction, 'id' | 'at'> & { at?: string }

export const TASK_ENTITIES = ['item', 'contact', 'deal', 'delivery', 'website_order'] as const
export type TaskEntity = (typeof TASK_ENTITIES)[number]

export interface Task {
  id: string
  title: string
  detail: string | null
  status: 'open' | 'done' | 'cancelled'
  dueAt: string | null
  assigneeProfileId: string | null
  entityKind: TaskEntity | null
  entityId: string | null
  source: string
  dedupeKey: string | null
  createdBy: string
  createdAt: string
  completedAt: string | null
  completedBy: string | null
}
export type TaskInput = Pick<Task, 'title' | 'createdBy'> & Partial<Pick<Task, 'detail' | 'dueAt' | 'assigneeProfileId' | 'entityKind' | 'entityId' | 'source' | 'dedupeKey'>>

export const DELIVERY_STATUSES = ['planned', 'out', 'done', 'failed', 'cancelled'] as const
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]

export interface Delivery {
  id: string
  itemId: string | null
  websiteOrderId: number | null
  websiteOrderNumber: string | null
  contactId: string | null
  address: string | null
  scheduledFor: string | null
  timeWindow: string | null
  assigneeProfileId: string | null
  status: DeliveryStatus
  note: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}
export type DeliveryInput = Partial<Omit<Delivery, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>> & { createdBy: string }
