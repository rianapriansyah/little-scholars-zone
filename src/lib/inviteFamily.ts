import { supabase } from './supabase'

export type InviteFamilyResult =
  | { ok: true; userId: string }
  | { ok: false; message: string }

export type InviteFamilyPayload = {
  name: string
  email: string
  phone?: string | null
}

/**
 * Creates a family record and sends an invite email in one atomic call via the
 * Edge Function `invite-family`. The function handles the DB insert + auth invite
 * server-side (redirect URL is configured as an env var on the function).
 * Deploy: `supabase functions deploy invite-family`
 */
export async function inviteFamily(payload: InviteFamilyPayload): Promise<InviteFamilyResult> {
  const { data, error } = await supabase.functions.invoke<{ userId?: string; error?: string }>(
    'invite-family',
    {
      body: {
        name: payload.name.trim(),
        email: payload.email.trim().toLowerCase(),
        phone: payload.phone?.trim() || null,
      },
    },
  )

  if (error) {
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

  return { ok: false, message: 'Invalid response from invite-family function.' }
}
