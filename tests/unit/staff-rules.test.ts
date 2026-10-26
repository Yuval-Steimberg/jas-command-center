import { describe, expect, it } from 'vitest'
import { refuseInvite, refuseResend, refuseStaffChange, type StaffMember } from '@/lib/staff/rules'

const m = (id: string, role: StaffMember['role'], active = true): StaffMember => ({ id, email: `${id}@x.co`, name: id, role, active })
const staff = [m('own', 'owner'), m('adm', 'admin'), m('ops', 'operations_manager'), m('old', 'viewer', false)]

describe('staff rules', () => {
  it('never lets a person change themselves', () => {
    expect(refuseStaffChange({ id: 'own', role: 'owner' }, staff, { kind: 'role', targetId: 'own', role: 'viewer' })).toMatch(/your own/)
  })
  it('keeps at least one active owner', () => {
    const two = [...staff, m('own2', 'owner')]
    expect(refuseStaffChange({ id: 'own2', role: 'owner' }, two, { kind: 'active', targetId: 'own', active: false })).toBeNull()
    expect(refuseStaffChange({ id: 'own2', role: 'owner' }, [m('own', 'owner'), m('own2', 'owner', false)], { kind: 'role', targetId: 'own', role: 'admin' })).toMatch(/last active owner/)
  })
  it('only an owner makes or unmakes owners', () => {
    expect(refuseStaffChange({ id: 'adm', role: 'admin' }, staff, { kind: 'role', targetId: 'ops', role: 'owner' })).toMatch(/Only an owner/)
    expect(refuseStaffChange({ id: 'adm', role: 'admin' }, staff, { kind: 'active', targetId: 'own', active: false })).toMatch(/Only an owner/)
    expect(refuseStaffChange({ id: 'adm', role: 'admin' }, staff, { kind: 'role', targetId: 'ops', role: 'viewer' })).toBeNull()
    expect(refuseInvite({ role: 'admin' }, staff, 'new@x.co', 'owner')).toMatch(/Only an owner/)
  })
  it('deletes anyone but yourself and the last active owner; owners only by an owner', () => {
    expect(refuseStaffChange({ id: 'own', role: 'owner' }, staff, { kind: 'delete', targetId: 'own' })).toMatch(/delete yourself/)
    expect(refuseStaffChange({ id: 'own2', role: 'owner' }, [m('own', 'owner'), m('own2', 'owner', false)], { kind: 'delete', targetId: 'own' })).toMatch(/last active owner/)
    expect(refuseStaffChange({ id: 'own', role: 'owner' }, [m('own', 'owner'), m('gone', 'owner', false)], { kind: 'delete', targetId: 'gone' })).toBeNull()
    expect(refuseStaffChange({ id: 'adm', role: 'admin' }, [...staff, m('gone', 'owner', false)], { kind: 'delete', targetId: 'gone' })).toMatch(/Only an owner/)
    expect(refuseStaffChange({ id: 'adm', role: 'admin' }, staff, { kind: 'delete', targetId: 'old' })).toBeNull()
    expect(refuseStaffChange({ id: 'own', role: 'owner' }, staff, { kind: 'delete', targetId: 'nobody' })).toMatch(/not on the staff/)
  })
  it('refuses a duplicate invite, case-insensitively', () => {
    expect(refuseInvite({ role: 'owner' }, staff, 'OPS@x.co', 'viewer')).toMatch(/already/)
    expect(refuseInvite({ role: 'owner' }, staff, 'new@x.co', 'viewer')).toBeNull()
  })
  it('sends a new link only to an active colleague, and an owner only from an owner', () => {
    expect(refuseResend({ id: 'own', role: 'owner' }, staff, 'ops')).toBeNull()
    expect(refuseResend({ id: 'own', role: 'owner' }, staff, 'own')).toMatch(/yourself/)
    expect(refuseResend({ id: 'own', role: 'owner' }, staff, 'old')).toMatch(/Reactivate/)
    expect(refuseResend({ id: 'adm', role: 'admin' }, staff, 'own')).toMatch(/Only an owner/)
    expect(refuseResend({ id: 'own', role: 'owner' }, staff, 'nobody')).toMatch(/not on the staff/)
  })
})
