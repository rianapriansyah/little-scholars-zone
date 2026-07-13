import { supabase } from './supabase'

export type CreateTeacherAccountResult =
  | { ok: true; userId: string; password: string; reused?: boolean }
  | { ok: false; message: string }

export type CreateTeacherAccountPayload = {
  fullName: string
  email: string
  phone?: string | null
}

/**
 * Creates a teacher record and a Supabase Auth login (with a generated password, no
 * email sent) in one atomic call via the Edge Function `create-teacher-account`. If the
 * email is already registered, the existing account's password is reset instead.
 * Deploy: `supabase functions deploy create-teacher-account`
 */
export async function createTeacherAccount(
  payload: CreateTeacherAccountPayload,
): Promise<CreateTeacherAccountResult> {
  const { data, error } = await supabase.functions.invoke<{
    userId?: string
    password?: string
    reused?: boolean
    error?: string
  }>('create-teacher-account', {
    body: {
      fullName: payload.fullName.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone?.trim() || null,
    },
  })

  if (error) {
    // supabase.functions.invoke wraps non-2xx as a generic error; try to extract
    // the actual message from the response body before falling back.
    const body = await (error.context as Response | undefined)?.json?.().catch(() => null) as { error?: string } | null
    const msg = body?.error ?? error.message
    return { ok: false, message: msg }
  }

  if (data && typeof data === 'object' && 'error' in data && data.error) {
    return { ok: false, message: String(data.error) }
  }

  if (data && typeof data === 'object' && data.userId && data.password) {
    return { ok: true, userId: data.userId, password: data.password, reused: data.reused }
  }

  return { ok: false, message: 'Invalid response from create-teacher-account function.' }
}
