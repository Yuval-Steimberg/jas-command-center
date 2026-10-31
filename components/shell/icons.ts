import {
  Gift, ShoppingBag, Sofa, Package, Truck, Store, Users, HeartHandshake, ChartLine, House, Receipt, ListChecks, Factory,
  MessageCircle, MapPinned, FileText, Sparkles, Bell, Cable, Settings, BookOpen, type LucideIcon,
} from 'lucide-react'
import type { NavIcon } from './nav'

/** One icon per place, shared by the sidebar, the home page and the Guide. */
export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  home: House, crm: Users, inventory: Package, sales: Receipt, shop: ShoppingBag, truck: Truck, tasks: ListChecks, supplier: Factory, volunteers: HeartHandshake, website: Store, agent: MessageCircle, furniture: Sofa, map: MapPinned, gift: Gift,
  analytics: ChartLine, report: FileText, assistant: Sparkles, bell: Bell, plug: Cable, settings: Settings, guide: BookOpen,
}
