import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROFILE_WITH_ROLES } from '@/lib/auth/profile-query'

/** Columns of cc_user_roles that reference cc_profiles, read from the real migration. */
function fksToProfiles(): string[] {
  const sql = readFileSync('supabase/migrations/0001_init.sql', 'utf8')
  const table = sql.match(/create table if not exists cc_user_roles \(([\s\S]*?)\n\);/)![1]!
  return [...table.matchAll(/^\s*(\w+)\s+uuid[^\n]*references cc_profiles\(id\)/gm)].map((m) => m[1]!)
}

describe('the sign-in profile query', () => {
  it('names which relationship it embeds when cc_user_roles has more than one to cc_profiles', () => {
    const fks = fksToProfiles()
    expect(fks).toEqual(['profile_id', 'granted_by'])
    // A bare `cc_user_roles(` is PGRST201 "more than one relationship was found" in production.
    expect(PROFILE_WITH_ROLES).not.toMatch(/cc_user_roles\(/)
    expect(PROFILE_WITH_ROLES).toMatch(/cc_user_roles!profile_id\(role\)/)
  })
})
