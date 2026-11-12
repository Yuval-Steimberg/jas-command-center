import { authMode } from '@/lib/auth/mode'
import { passkeyCount, passkeysEnabled } from '@/lib/auth/passkeys'
import { FaceIdOffer } from './face-id-offer'

/** Server half of the offer: only for a signed-in person with no passkey saved, when passkeys are on. */
export async function FaceIdOfferSlot({ userId, className }: { userId: string; className?: string }) {
  if (authMode().kind !== 'supabase') return null
  if ((await passkeysEnabled()) === false) return null
  if ((await passkeyCount(userId)) !== 0) return null
  return (
    <div className={className}>
      <FaceIdOffer />
    </div>
  )
}
