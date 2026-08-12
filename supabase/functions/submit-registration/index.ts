/// <reference path="./deno-shim.d.ts" />
// Deploy: supabase functions deploy submit-registration
//
// The one endpoint an anonymous visitor can reach (verify_jwt = false in config.toml). It
// exists so the public registration wizard never needs an anon INSERT policy on the
// registration tables nor an anon write policy on the receipts bucket — everything here runs
// under the service role, behind validation this file owns.
//
// Two actions, because the receipt is uploaded straight to Storage rather than streamed
// through this function (matching how uploadProfilePhoto works elsewhere in the app):
//
//   1. { action: 'receipt-url' } -> a single-use signed upload URL scoped to one object path.
//   2. { action: 'submit' }      -> validates the form, re-reads prices from the DB, and
//                                   writes the submission + its children.
//
// Submitting last is deliberate: a pending row always has its receipt attached, so the admin
// review queue never contains something that cannot be reviewed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BUCKET = 'payment-receipts'
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024
const ALLOWED_RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
const MAX_CHILDREN = 10
/** Minutes during which the same phone number cannot file a second pending submission. */
const DUPLICATE_WINDOW_MINUTES = 10

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Trim, collapse to null when empty, and cap length — this input is unauthenticated. */
function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, maxLength)
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

type ChildPayload = {
  fullName?: unknown
  birthPlace?: unknown
  birthdate?: unknown
  notes?: unknown
  classroomId?: unknown
}

type SubmitPayload = {
  familyName?: unknown
  contactPhone?: unknown
  fatherName?: unknown
  fatherOccupation?: unknown
  fatherPhone?: unknown
  motherName?: unknown
  motherOccupation?: unknown
  motherPhone?: unknown
  address?: unknown
  paymentNote?: unknown
  receiptPath?: unknown
  children?: unknown
}

function extensionFor(fileName: string, contentType: string): string {
  const fromName = fileName.includes('.') ? fileName.split('.').pop()! : ''
  const safe = fromName.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (safe && safe.length <= 5) return safe
  return contentType === 'application/pdf' ? 'pdf' : 'jpg'
}

/** Signed upload URL for one freshly-minted object path. The client PUTs the file to it. */
async function handleReceiptUrl(
  adminClient: ReturnType<typeof createClient>,
  body: { fileName?: unknown; contentType?: unknown; size?: unknown },
): Promise<Response> {
  const contentType = typeof body.contentType === 'string' ? body.contentType.toLowerCase() : ''
  const fileName = typeof body.fileName === 'string' ? body.fileName : ''
  const size = typeof body.size === 'number' ? body.size : 0

  if (!ALLOWED_RECEIPT_TYPES.includes(contentType)) {
    return jsonResponse({ error: 'Format bukti pembayaran harus JPG, PNG, WEBP, HEIC, atau PDF.' }, 400)
  }
  if (size <= 0 || size > MAX_RECEIPT_BYTES) {
    return jsonResponse({ error: 'Ukuran bukti pembayaran maksimal 5 MB.' }, 400)
  }

  const path = `${crypto.randomUUID()}.${extensionFor(fileName, contentType)}`
  const { data, error } = await adminClient.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data) {
    console.error('createSignedUploadUrl:', error?.message)
    return jsonResponse({ error: 'Gagal menyiapkan unggahan bukti pembayaran.' }, 500)
  }

  return jsonResponse({ path: data.path, token: data.token })
}

/** True when the object actually landed in the bucket — guards against a submit with a fabricated path. */
async function receiptExists(
  adminClient: ReturnType<typeof createClient>,
  path: string,
): Promise<boolean> {
  const { data, error } = await adminClient.storage.from(BUCKET).list('', { limit: 1, search: path })
  if (error) {
    console.error('receipt list:', error.message)
    return false
  }
  return (data ?? []).some((entry: { name: string }) => entry.name === path)
}

async function handleSubmit(
  adminClient: ReturnType<typeof createClient>,
  payload: SubmitPayload,
): Promise<Response> {
  const familyName = cleanText(payload.familyName, 120)
  const contactPhone = cleanText(payload.contactPhone, 30)
  const receiptPath = cleanText(payload.receiptPath, 200)

  if (!familyName) return jsonResponse({ error: 'Nama keluarga wajib diisi.' }, 400)
  if (!contactPhone || !/\d/.test(contactPhone)) {
    return jsonResponse({ error: 'Nomor telepon kontak wajib diisi.' }, 400)
  }
  if (!receiptPath || receiptPath.includes('/')) {
    return jsonResponse({ error: 'Bukti pembayaran belum terunggah.' }, 400)
  }

  const rawChildren = Array.isArray(payload.children) ? (payload.children as ChildPayload[]) : []
  if (rawChildren.length === 0) return jsonResponse({ error: 'Tambahkan minimal satu anak.' }, 400)
  if (rawChildren.length > MAX_CHILDREN) {
    return jsonResponse({ error: `Maksimal ${MAX_CHILDREN} anak per pendaftaran.` }, 400)
  }

  const children = rawChildren.map((child) => ({
    full_name: cleanText(child.fullName, 120),
    birth_place: cleanText(child.birthPlace, 120),
    birthdate: isIsoDate(child.birthdate) ? child.birthdate : null,
    notes: cleanText(child.notes, 2000),
    classroom_id: cleanText(child.classroomId, 64),
  }))

  if (children.some((child) => !child.full_name)) {
    return jsonResponse({ error: 'Setiap anak harus punya nama lengkap.' }, 400)
  }
  if (children.some((child) => !child.classroom_id)) {
    return jsonResponse({ error: 'Setiap anak harus dipilihkan program.' }, 400)
  }

  // Prices come from the database, never from the client: amount_total is what the uploaded
  // receipt is proof of, so the browser must not get a vote in it.
  const classroomIds = Array.from(new Set(children.map((child) => child.classroom_id!)))
  const { data: classrooms, error: classroomError } = await adminClient
    .from('classrooms')
    .select('id, price, active')
    .in('id', classroomIds)
  if (classroomError) {
    console.error('classroom lookup:', classroomError.message)
    return jsonResponse({ error: 'Gagal memuat data program.' }, 500)
  }

  const priceById = new Map<string, number>()
  for (const row of (classrooms ?? []) as { id: string; price: number; active: boolean }[]) {
    if (row.active) priceById.set(row.id, Number(row.price))
  }
  if (children.some((child) => !priceById.has(child.classroom_id!))) {
    return jsonResponse({ error: 'Salah satu program yang dipilih sudah tidak tersedia. Muat ulang halaman.' }, 400)
  }

  // Mandatory per-child equipment fee (uniform + stationery) — every child owes this on top of
  // their program, so it is not something the client selects. Snapshotted here for the same
  // reason program prices are: a later price change in registration_fee_items must not rewrite
  // what this family already paid for.
  const { data: feeItems, error: feeItemsError } = await adminClient
    .from('registration_fee_items')
    .select('price')
    .eq('active', true)
  if (feeItemsError) {
    console.error('fee items lookup:', feeItemsError.message)
    return jsonResponse({ error: 'Gagal memuat biaya perlengkapan wajib.' }, 500)
  }
  const equipmentFeePerChild = ((feeItems ?? []) as { price: number }[]).reduce(
    (sum: number, row) => sum + Number(row.price),
    0,
  )

  const amountTotal = children.reduce(
    (sum, child) => sum + priceById.get(child.classroom_id!)! + equipmentFeePerChild,
    0,
  )

  // Cheap abuse / double-submit guard for an unauthenticated endpoint.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MINUTES * 60_000).toISOString()
  const { count: recentCount, error: recentError } = await adminClient
    .from('registration_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('contact_phone', contactPhone)
    .eq('status', 'pending')
    .gte('submitted_at', since)
  if (recentError) {
    console.error('duplicate check:', recentError.message)
  } else if ((recentCount ?? 0) > 0) {
    return jsonResponse(
      { error: 'Pendaftaran dengan nomor ini baru saja dikirim dan masih menunggu verifikasi.' },
      429,
    )
  }

  if (!(await receiptExists(adminClient, receiptPath))) {
    return jsonResponse({ error: 'Bukti pembayaran belum terunggah.' }, 400)
  }

  const { data: submission, error: insertError } = await adminClient
    .from('registration_submissions')
    .insert({
      family_name: familyName,
      contact_phone: contactPhone,
      father_name: cleanText(payload.fatherName, 120),
      father_occupation: cleanText(payload.fatherOccupation, 120),
      father_phone: cleanText(payload.fatherPhone, 30),
      mother_name: cleanText(payload.motherName, 120),
      mother_occupation: cleanText(payload.motherOccupation, 120),
      mother_phone: cleanText(payload.motherPhone, 30),
      address: cleanText(payload.address, 500),
      payment_note: cleanText(payload.paymentNote, 500),
      receipt_path: receiptPath,
      amount_total: amountTotal,
    })
    .select('id, reference_code')
    .single()

  if (insertError || !submission) {
    console.error('submission insert:', insertError?.message)
    return jsonResponse({ error: 'Gagal menyimpan pendaftaran.' }, 500)
  }

  const row = submission as { id: string; reference_code: string }

  const { error: childrenError } = await adminClient.from('registration_children').insert(
    children.map((child) => ({
      submission_id: row.id,
      full_name: child.full_name,
      birth_place: child.birth_place,
      birthdate: child.birthdate,
      notes: child.notes,
      classroom_id: child.classroom_id,
      price: priceById.get(child.classroom_id!)!,
      equipment_fee: equipmentFeePerChild,
    })),
  )

  if (childrenError) {
    // PostgREST gives no cross-request transaction, so undo the parent row rather than leave a
    // childless submission in the review queue.
    await adminClient.from('registration_submissions').delete().eq('id', row.id)
    console.error('children insert:', childrenError.message)
    return jsonResponse({ error: 'Gagal menyimpan data anak.' }, 500)
  }

  return jsonResponse({ referenceCode: row.reference_code })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: 'Server misconfigured' }, 500)
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body = (await req.json()) as { action?: unknown } & Record<string, unknown>

    if (body.action === 'receipt-url') {
      return await handleReceiptUrl(
        adminClient,
        body as { fileName?: unknown; contentType?: unknown; size?: unknown },
      )
    }
    if (body.action === 'submit') {
      return await handleSubmit(adminClient, body as SubmitPayload)
    }
    return jsonResponse({ error: 'Unknown action' }, 400)
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Server error'
    console.error('Unhandled exception:', message)
    return jsonResponse({ error: message }, 500)
  }
})
