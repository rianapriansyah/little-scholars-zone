/// <reference path="./deno-shim.d.ts" />
// Deploy: supabase functions deploy invite-teacher
// Set secret: supabase secrets set INVITE_REDIRECT_URL=https://<your-app>/accept-invite
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Links teachers row (by email) to the Supabase Auth user so teachers can log in without a client-side claim RPC. */
async function linkTeacherAuthUser(
  adminClient: ReturnType<typeof createClient>,
  email: string,
  authUserId: string,
): Promise<void> {
  const { error } = await adminClient
    .from('teachers')
    .update({ auth_user_id: authUserId })
    .eq('email', email)
  if (error) {
    console.error('linkTeacherAuthUser:', error.message)
  }
}

async function findUserIdByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const normalized = email.toLowerCase()
  let page = 1
  const perPage = 1000
  for (;;) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage })
    if (error || !data?.users?.length) return null
    const hit = data.users.find((u) => u.email?.toLowerCase() === normalized)
    if (hit?.id) return hit.id
    if (data.users.length < perPage) return null
    page += 1
    if (page > 50) return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Missing or invalid Authorization' }, 401)
    }

    // Decode JWT inline — no extra HTTP round-trip
    const token = authHeader.slice('Bearer '.length).trim()
    let jwtPayload: Record<string, unknown>
    try {
      const payloadB64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      jwtPayload = JSON.parse(atob(payloadB64)) as Record<string, unknown>
    } catch {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const exp = jwtPayload['exp'] as number | undefined
    if (!exp || Math.floor(Date.now() / 1000) > exp) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }

    const appMeta = jwtPayload['app_metadata'] as Record<string, unknown> | undefined
    if (appMeta?.['role'] !== 'admin') {
      return jsonResponse({ error: 'Forbidden' }, 403)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Server misconfigured' }, 500)
    }

    const body = (await req.json()) as { email?: string; fullName?: string; phone?: string | null }
    const email = body.email?.trim().toLowerCase()
    const fullName = body.fullName?.trim() || email
    const phone = body.phone?.trim() || null
    if (!email) {
      return jsonResponse({ error: 'email is required' }, 400)
    }

    // Redirect URL is configured server-side (shared with invite-family) — set via:
    // supabase secrets set INVITE_REDIRECT_URL=https://<your-app>/accept-invite
    const redirectTo = Deno.env.get('INVITE_REDIRECT_URL')?.trim() || undefined

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Ensure a teachers row exists before sending the invite email.
    // Using upsert with ignoreDuplicates=true so resend-invite doesn't overwrite.
    const { error: upsertErr } = await adminClient
      .from('teachers')
      .upsert(
        { full_name: fullName!, email, contact_phone: phone, active: true },
        { onConflict: 'email', ignoreDuplicates: true },
      )
    if (upsertErr) {
      console.error('Failed to upsert teachers:', upsertErr.message)
      // Non-fatal: teacher row may already exist; continue with invite
    }

    const { data, error } = await adminClient.auth.admin.inviteUserByEmail(
      email,
      { ...(redirectTo ? { redirectTo } : {}) },
    )

    if (!error && data?.user?.id) {
      await linkTeacherAuthUser(adminClient, email, data.user.id)
      return jsonResponse({ userId: data.user.id })
    }

    const msg = error?.message?.toLowerCase() ?? ''
    const already =
      msg.includes('already') ||
      msg.includes('registered') ||
      msg.includes('exists') ||
      error?.status === 422

    if (already) {
      const existingId = await findUserIdByEmail(adminClient, email)
      if (existingId) {
        await linkTeacherAuthUser(adminClient, email, existingId)
        return jsonResponse({ userId: existingId, reused: true })
      }
    }

    return jsonResponse({ error: error?.message ?? 'Invite failed' }, 400)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Server error'
    console.error('Unhandled exception:', message)
    return jsonResponse({ error: message }, 500)
  }
})
