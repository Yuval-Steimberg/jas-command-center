# Sign in with Face ID (passkeys)

Staff sign in to the command center, the team portal (`/portal`), shop mode (`/shop`) and schedule mode (`/schedule`)
with a **passkey**: the phone's Face ID / fingerprint (or Touch ID / Windows Hello on a computer) unlocks a key saved
on that device. Web pages cannot call Face ID directly; passkeys are the standard way, and iPhones and Android phones
unlock them with the face or fingerprint.

## How it works

- **Supabase Auth does all of it** (passkeys, beta since May 2026): it stores each person's passkeys, issues the
  challenge and checks the answer. The command center keeps nothing about them and needs no migration.
- Both ceremonies run through server actions, so the session cookie is set exactly as a password sign-in sets it and
  the same profile + role check runs (`app/login/passkey-actions.ts`). The browser only converts formats and shows the
  Face ID sheet (`lib/auth/passkey-browser.ts`, pure, tested; checked against Chromium's virtual authenticator).
- The challenge is fetched **before** the tap (`components/auth/use-challenge.ts`): Safari only opens the Face ID
  sheet shortly after a tap, and a server round trip in between can spend that window.
- Turning it on: each person, once per device, on `/portal/face-id` (Hebrew). The portal home and the shop home show
  a quiet offer to anyone with no passkey on a device that has Face ID / a fingerprint reader, until they tap ✕.
  The page also lists the person's devices with "last used", and removes a lost phone.
- Audited: `auth.login` with `detail.method = passkey`; `auth.passkey_add` / `auth.passkey_remove` (requested, then
  the outcome). Sign-in attempts share the password sign-in's rate limit.
- Not covered: the furniture app and the gift card system (their own logins), and the **volunteers app**, which does
  not use Supabase Auth at all (its own email code + a 60-day cookie), on a different domain.

## Owner setup (once)

1. Supabase dashboard → the **command center** project → **Authentication → Passkeys**:
   - Turn on **Enable Passkey authentication**.
   - **Relying Party ID**: `jas-command-center.vercel.app` (exactly, no `https://`).
   - **Relying Party Origins**: `https://jas-command-center.vercel.app,http://localhost:3000`
   - **Relying Party Display Name**: `JAS`
   - Save.
2. Open `https://jas-command-center.vercel.app/login`. A **כניסה עם Face ID** button above the password form means
   Supabase reports passkeys as on. (Until then the button is hidden and `/portal/face-id` says it is not switched on.)
   A user report says the setting can take a while to reach sign-in; if the button does not appear after 5 minutes,
   change and revert any other Auth setting to push the configuration.
3. Sign in with your password, open **כניסה עם Face ID** (`/portal/face-id`), tap **הפעלת Face ID במכשיר הזה**.
   Sign out, tap **כניסה עם Face ID** on the login page.

**The Relying Party ID is permanent for every saved passkey.** If the command center moves to its own domain
(say `cc.justasecond.co.il`), change the ID to that domain and everyone turns Face ID on again once; the old passkeys
stop working. Passwords are unaffected either way.

## Error codes shown in Hebrew

`passkey_disabled`, `webauthn_credential_not_found` (the device's passkey was removed), `webauthn_challenge_expired`,
`too_many_passkeys`, `SecurityError` (this address is not in Relying Party Origins), `NotAllowedError` (the person
closed the sheet: not shown as an error). See `passkeyMessage`.
