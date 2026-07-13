import type { User } from '@supabase/supabase-js'
import { getAppRole } from './authRole'

/**
 * Role lives entirely in the JWT's app_metadata (set when the account is created —
 * see create-teacher-account/create-family-account), so this is a synchronous, free
 * check — no DB round trip. The destination route guard (TeacherRoute/ParentRoute)
 * still does the authoritative row lookup; this only picks which guard to send the
 * user to (mirrors car-rental's LoginPage, which is sync for the same reason).
 */
export function resolveDestination(user: User): string | null {
  const role = getAppRole(user)
  if (role === 'admin') return '/admin'
  if (role === 'teacher') return '/teacher'
  if (role === 'parent') return '/parent'
  return null
}
