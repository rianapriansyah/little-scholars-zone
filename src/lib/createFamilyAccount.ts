import { supabase } from './supabase'

export type CreateFamilyAccountResult =
  | { ok: true; userId: string; password: string; reused?: boolean }
  | { ok: false; message: string }

export type CreateFamilyAccountPayload = {
  name: string
  email: string
  phone?: string | null
}

/**
 * Creates a family record and a Supabase Auth login (with a generated password, no
 * email sent) in one atomic call via the Edge Function `create-family-account`. If the
 * email is already registered, the existing account's password is reset instead.
 * Deploy: `supabase functions deploy create-family-account`
 */
export async function createFamilyAccount(
  payload: CreateFamilyAccountPayload,
): Promise<CreateFamilyAccountResult> {
  const { data, error } = await supabase.functions.invoke<{
    userId?: string
    password?: string
    reused?: boolean
    error?: string
  }>('create-family-account', {
    body: {
      name: payload.name.trim(),
      email: payload.email.trim().toLowerCase(),
      phone: payload.phone?.trim() || null,
    },
  })

  if (error) {
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

  return { ok: false, message: 'Invalid response from create-family-account function.' }
}
