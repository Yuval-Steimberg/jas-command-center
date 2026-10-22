import { CardSkeleton } from '@/components/skeleton'

export default function Loading() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <CardSkeleton />
      <CardSkeleton />
    </div>
  )
}
