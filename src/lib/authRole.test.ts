import { describe, expect, it } from 'vitest'
import type { User } from '@supabase/supabase-js'
import { isAdminUser } from './authRole'

function makeUser(appMetadata: Record<string, unknown> | undefined): User {
  return {
    id: 'u1',
    app_metadata: appMetadata ?? {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '',
  } as User
}

describe('isAdminUser', () => {
  it('returns true when app_metadata.role is admin', () => {
    expect(isAdminUser(makeUser({ role: 'admin' }))).toBe(true)
  })

  it('returns false for missing or non-admin role', () => {
    expect(isAdminUser(null)).toBe(false)
    expect(isAdminUser(makeUser({ role: 'teacher' }))).toBe(false)
    expect(isAdminUser(makeUser({}))).toBe(false)
  })
})
