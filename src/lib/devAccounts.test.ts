import { describe, expect, it } from 'vitest'
import { isDevRoleSwitcherEnabled, readDevAccounts, type EnvLike } from './devAccounts'

const FULL: EnvLike = {
  VITE_DEV_ROLE_SWITCHER: 'true',
  VITE_DEV_ADMIN_EMAIL: 'admin@example.test',
  VITE_DEV_ADMIN_PASSWORD: 'pw-admin',
  VITE_DEV_TEACHER_EMAIL: 'teacher@example.test',
  VITE_DEV_TEACHER_PASSWORD: 'pw-teacher',
  VITE_DEV_PARENT_EMAIL: 'parent@example.test',
  VITE_DEV_PARENT_PASSWORD: 'pw-parent',
}

describe('isDevRoleSwitcherEnabled', () => {
  it('requires exactly the string "true"', () => {
    expect(isDevRoleSwitcherEnabled({ VITE_DEV_ROLE_SWITCHER: 'true' })).toBe(true)
    expect(isDevRoleSwitcherEnabled({ VITE_DEV_ROLE_SWITCHER: 'TRUE' })).toBe(false)
    expect(isDevRoleSwitcherEnabled({ VITE_DEV_ROLE_SWITCHER: '1' })).toBe(false)
    expect(isDevRoleSwitcherEnabled({ VITE_DEV_ROLE_SWITCHER: true })).toBe(false)
    expect(isDevRoleSwitcherEnabled({})).toBe(false)
  })
})

describe('readDevAccounts', () => {
  it('returns every fully configured role, in admin/teacher/parent order', () => {
    expect(readDevAccounts(FULL).map((a) => a.role)).toEqual(['admin', 'teacher', 'parent'])
  })

  it('returns nothing at all when the flag is off, whatever else is set', () => {
    expect(readDevAccounts({ ...FULL, VITE_DEV_ROLE_SWITCHER: undefined })).toEqual([])
    expect(readDevAccounts({ ...FULL, VITE_DEV_ROLE_SWITCHER: 'false' })).toEqual([])
  })

  it('skips a role missing its password rather than offering a sign-in that must fail', () => {
    const roles = readDevAccounts({ ...FULL, VITE_DEV_TEACHER_PASSWORD: undefined }).map((a) => a.role)
    expect(roles).toEqual(['admin', 'parent'])
  })

  it('skips a role whose email is blank', () => {
    const roles = readDevAccounts({ ...FULL, VITE_DEV_PARENT_EMAIL: '   ' }).map((a) => a.role)
    expect(roles).toEqual(['admin', 'teacher'])
  })

  it('trims the email but leaves the password byte-for-byte', () => {
    const [admin] = readDevAccounts({ ...FULL, VITE_DEV_ADMIN_EMAIL: '  admin@example.test  ' })
    expect(admin.email).toBe('admin@example.test')
    expect(admin.password).toBe('pw-admin')
  })
})
