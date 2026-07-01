import { supabase } from './supabase'

export type InviteTeacherResult =
  | { ok: true; userId: string }
  | { ok: false; message: string }

export type InviteTeacherPayload = {
  fullName: string
  email: string
  phone?: string | null
}

/**
 * Creates a teacher record and sends an invite email in one atomic call via the
 * Edge Function `invite-teacher`. The function handles the DB insert + auth invite
 * server-side (redirect URL is configured as an env var on the function).
 * Deploy: `supabase functions deploy invite-teacher`
 */
export async function inviteTeacher(payload: InviteTeacherPayload): Promise<InviteTeacherResult> {
  const { data, error } = await supabase.functions.invoke<{ userId?: string; error?: string }>(
    'invite-teacher',
    {
      body: {
        fullName: payload.fullName.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: payload.phone?.trim() || null,
      },
    },
  )

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

  if (data && typeof data === 'object' && data.userId) {
    return { ok: true, userId: data.userId }
  }

  return { ok: false, message: 'Invalid response from invite-teacher function.' }
}
