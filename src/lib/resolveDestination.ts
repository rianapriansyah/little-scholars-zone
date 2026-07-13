import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { isAdminUser } from './authRole'

/** Admin is an app_metadata role; teacher/parent are row lookups (mirrors car-rental's partner check). */
export async function resolveDestination(user: User): Promise<string | null> {
  if (isAdminUser(user)) return '/admin'

  const { data: teacher } = await supabase
    .from('teachers')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (teacher) return '/teacher'

  const { data: family } = await supabase
    .from('families')
    .select('id')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (family) return '/parent'

  return null
}
