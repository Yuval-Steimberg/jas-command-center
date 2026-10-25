import { minorToShekels } from '@/components/sales/copy'
import { EMPTY_DIMENSIONS, parseDimensions, type Dimensions } from '@/lib/inventory/dimensions'

/** The item form's fields as strings. Not a client module, so server pages can build them. */
export interface ItemFormValues {
  title: string
  category: string
  colors: string
  material: string
  /** Length / width / height / diameter (cm) + anything an older row said that does not fit them. */
  dims: Dimensions
  description: string
  price: string
  priceApproved: boolean
  aiPrice: string
  condition: string
  quantity: string
  cost: string
  photoUrl: string
  photoHash: string
  extraPhotos: string[]
}
export const EMPTY_ITEM: ItemFormValues = { title: '', category: '', colors: '', material: '', dims: EMPTY_DIMENSIONS, description: '', price: '', priceApproved: true, aiPrice: '', condition: 'good', quantity: '1', cost: '', photoUrl: '', photoHash: '', extraPhotos: [] }

/** An item's current values as form strings. */
export function valuesOf(i: {
  title: string; category: string | null; colors?: string | null; material: string | null; dimensions: string | null; description: string | null; priceMinor: number | null
  priceApproved?: boolean; aiPriceMinor?: number | null; condition: string | null; quantity: number; unitCostMinor?: number | null; photoUrl: string | null; photoHash?: string | null; extraPhotos?: string[]
}): ItemFormValues {
  return {
    title: i.title, category: i.category ?? '', colors: i.colors ?? '', material: i.material ?? '', dims: parseDimensions(i.dimensions), description: i.description ?? '',
    price: minorToShekels(i.priceMinor), priceApproved: i.priceApproved ?? true, aiPrice: i.aiPriceMinor != null ? minorToShekels(i.aiPriceMinor) : '',
    condition: i.condition ?? '', quantity: String(i.quantity), cost: minorToShekels(i.unitCostMinor ?? null), photoUrl: i.photoUrl ?? '', photoHash: i.photoHash ?? '', extraPhotos: i.extraPhotos ?? [],
  }
}
