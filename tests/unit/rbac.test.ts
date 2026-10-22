import { describe, expect, it } from 'vitest'
import { ACTIONS, PRODUCTS, ROLES, assertCan, can, primaryRole, ForbiddenError, type Permission } from '@/lib/auth/rbac'

describe('rbac', () => {
  it('owner holds every permission', () => {
    for (const p of PRODUCTS) for (const a of ACTIONS) expect(can('owner', `${p}:${a}`)).toBe(true)
    expect(can('owner', 'users:manage')).toBe(true)
  })

  it('money-moving gift card actions are owner-only by default', () => {
    for (const r of ROLES) expect(can(r, 'gift_cards:financial')).toBe(r === 'owner')
  })

  it('viewer reads every product and writes nothing', () => {
    for (const p of PRODUCTS) {
      expect(can('viewer', `${p}:read`)).toBe(true)
      for (const a of ['read_pii', 'operate', 'write', 'financial'] as const) expect(can('viewer', `${p}:${a}`)).toBe(false)
    }
  })

  it('project manager is scoped to furniture (and the public map)', () => {
    expect(can('project_manager', 'furniture:write')).toBe(true)
    expect(can('project_manager', 'map:read')).toBe(true)
    expect(can('project_manager', 'gift_cards:read')).toBe(false)
    expect(can('project_manager', 'website:read')).toBe(false)
  })

  it('no role and unknown roles get nothing', () => {
    expect(can(null, 'website:read')).toBe(false)
    expect(primaryRole(['superuser'])).toBeNull()
  })

  it('picks the most privileged role', () => {
    expect(primaryRole(['viewer', 'admin'])).toBe('admin')
    expect(primaryRole(['project_manager', 'owner', 'viewer'])).toBe('owner')
  })

  it('overrides grant and revoke', () => {
    expect(can('viewer', 'website:operate', { viewer: { 'website:operate': true } })).toBe(true)
    expect(can('admin', 'website:read', { admin: { 'website:read': false } })).toBe(false)
  })

  it('an override can never lock the owner out of user management', () => {
    expect(can('owner', 'users:manage', { owner: { 'users:manage': false } })).toBe(true)
  })

  it('assertCan throws a 403 naming the permission', () => {
    try {
      assertCan('viewer', 'gift_cards:financial' as Permission)
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenError)
      expect((e as ForbiddenError).status).toBe(403)
      expect((e as ForbiddenError).permission).toBe('gift_cards:financial')
    }
  })
})
