import { supabase } from './supabase'
import type { Result } from './result'
import type { FeeItemOption, SubmitPayload, ProgramOption, ReceiptMeta } from './registrationDraft'

export type RegistrationStatus = 'pending' | 'approved' | 'rejected'

export type RegistrationSummary = {
  id: string
  referenceCode: string
  status: RegistrationStatus
  familyName: string
  contactPhone: string
  amountTotal: number
  childCount: number
  submittedAt: string
}

export type RegistrationChildDetail = {
  id: string
  fullName: string
  birthPlace: string | null
  birthdate: string | null
  notes: string | null
  classroomId: string
  classroomLabel: string
  price: number
  equipmentFee: number
}

export type RegistrationDetail = RegistrationSummary & {
  fatherName: string | null
  fatherOccupation: string | null
  fatherPhone: string | null
  motherName: string | null
  motherOccupation: string | null
  motherPhone: string | null
  address: string | null
  paymentNote: string | null
  receiptPath: string
  rejectionReason: string | null
  reviewedAt: string | null
  children: RegistrationChildDetail[]
}

/** Active, billable programs — the same list an admin sees, minus anything not on offer. */
export async function fetchPublicPrograms(): Promise<Result<ProgramOption[]>> {
  const { data, error } = await supabase.rpc('list_active_programs')
  if (error) return { ok: false, error: error.message }
  const programs: ProgramOption[] = (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    timeStart: row.time_start,
    timeEnd: row.time_end,
    price: Number(row.price),
    guaranteedDays: row.guaranteed_days,
  }))
  return { ok: true, data: programs }
}

/** Mandatory per-child equipment fees (uniform, stationery) — nothing to select, just to show. */
export async function fetchMandatoryFeeItems(): Promise<Result<FeeItemOption[]>> {
  const { data, error } = await supabase.rpc('list_registration_fee_items')
  if (error) return { ok: false, error: error.message }
  const items: FeeItemOption[] = (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    price: Number(row.price),
    items: row.items ?? [],
    sortOrder: row.sort_order,
  }))
  return { ok: true, data: items }
}

/**
 * Two calls to submit-registration, matching how uploadProfilePhoto works elsewhere: get a
 * signed upload URL, PUT the file to Storage, then hand the resulting path to `submit` so the
 * registration row is only ever created with its receipt already attached.
 */
export async function submitRegistration(
  payload: SubmitPayload,
  receipt: File,
): Promise<Result<{ referenceCode: string }>> {
  const urlResult = await supabase.functions.invoke<{ path?: string; token?: string; error?: string }>(
    'submit-registration',
    { body: { action: 'receipt-url', fileName: receipt.name, contentType: receipt.type, size: receipt.size } },
  )
  if (urlResult.error || !urlResult.data?.path || !urlResult.data.token) {
    return { ok: false, error: urlResult.data?.error ?? urlResult.error?.message ?? 'Gagal menyiapkan unggahan.' }
  }

  const { path, token } = urlResult.data
  const { error: uploadError } = await supabase.storage
    .from('registration-receipts')
    .uploadToSignedUrl(path, token, receipt)
  if (uploadError) {
    return { ok: false, error: `Gagal mengunggah bukti pembayaran: ${uploadError.message}` }
  }

  const submitResult = await supabase.functions.invoke<{ referenceCode?: string; error?: string }>(
    'submit-registration',
    { body: { action: 'submit', ...payload, receiptPath: path } },
  )
  if (submitResult.error || !submitResult.data?.referenceCode) {
    const body = await (submitResult.error?.context as Response | undefined)?.json?.().catch(() => null) as
      | { error?: string }
      | null
    return {
      ok: false,
      error: body?.error ?? submitResult.data?.error ?? submitResult.error?.message ?? 'Gagal mengirim pendaftaran.',
    }
  }

  return { ok: true, data: { referenceCode: submitResult.data.referenceCode } }
}

/** Client-side mirror of submit-registration's own checks, so the wizard fails fast. */
export function receiptMetaFromFile(file: File): ReceiptMeta {
  return { name: file.name, size: file.size, type: file.type }
}

export async function fetchRegistrationSubmissions(
  status: RegistrationStatus | 'all',
): Promise<Result<RegistrationSummary[]>> {
  let query = supabase
    .from('registration_submissions')
    .select('id, reference_code, status, family_name, contact_phone, amount_total, submitted_at, registration_children(id)')
    .order('submitted_at', { ascending: false })
  if (status !== 'all') query = query.eq('status', status)

  const { data, error } = await query
  if (error) return { ok: false, error: error.message }

  const rows = (data ?? []).map((row) => ({
    id: row.id,
    referenceCode: row.reference_code,
    status: row.status as RegistrationStatus,
    familyName: row.family_name,
    contactPhone: row.contact_phone,
    amountTotal: Number(row.amount_total),
    childCount: (row.registration_children as unknown as { id: string }[] | null)?.length ?? 0,
    submittedAt: row.submitted_at,
  }))
  return { ok: true, data: rows }
}

export async function fetchRegistrationSubmission(id: string): Promise<Result<RegistrationDetail>> {
  const { data, error } = await supabase
    .from('registration_submissions')
    .select('*, registration_children(*, classrooms(label))')
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Pendaftaran tidak ditemukan.' }

  const rawChildren = (data.registration_children ?? []) as unknown as {
    id: string
    full_name: string
    birth_place: string | null
    birthdate: string | null
    notes: string | null
    classroom_id: string
    price: number
    equipment_fee: number
    classrooms: { label: string } | null
  }[]

  return {
    ok: true,
    data: {
      id: data.id,
      referenceCode: data.reference_code,
      status: data.status as RegistrationStatus,
      familyName: data.family_name,
      contactPhone: data.contact_phone,
      amountTotal: Number(data.amount_total),
      childCount: rawChildren.length,
      submittedAt: data.submitted_at,
      fatherName: data.father_name,
      fatherOccupation: data.father_occupation,
      fatherPhone: data.father_phone,
      motherName: data.mother_name,
      motherOccupation: data.mother_occupation,
      motherPhone: data.mother_phone,
      address: data.address,
      paymentNote: data.payment_note,
      receiptPath: data.receipt_path,
      rejectionReason: data.rejection_reason,
      reviewedAt: data.reviewed_at,
      children: rawChildren.map((child) => ({
        id: child.id,
        fullName: child.full_name,
        birthPlace: child.birth_place,
        birthdate: child.birthdate,
        notes: child.notes,
        classroomId: child.classroom_id,
        classroomLabel: child.classrooms?.label ?? '—',
        price: Number(child.price),
        equipmentFee: Number(child.equipment_fee),
      })),
    },
  }
}

/** Short-lived signed URL for the private receipt — admin only, per the storage policy. */
export async function fetchReceiptSignedUrl(receiptPath: string): Promise<Result<string>> {
  const { data, error } = await supabase.storage
    .from('registration-receipts')
    .createSignedUrl(receiptPath, 60 * 10)
  if (error || !data) return { ok: false, error: error?.message ?? 'Gagal memuat bukti pembayaran.' }
  return { ok: true, data: data.signedUrl }
}

/**
 * Approves a submission: creates the family, its children, and a learning period per child
 * (all inside approve_registration), then hands off to create-family-account for the login —
 * same two-step split the admin "Tambah Keluarga" flow already uses, so the caller can show
 * the same CredentialsRevealDialog.
 *
 * startDates is keyed by registration_children.id, one entry per child in the submission —
 * siblings can start on different dates (different programs, different readiness), so this is
 * never a single date applied to everyone.
 */
export async function approveRegistration(params: {
  submissionId: string
  loginEmail: string
  startDates: Record<string, string>
}): Promise<Result<{ familyId: string }>> {
  const { data, error } = await supabase.rpc('approve_registration', {
    p_submission_id: params.submissionId,
    p_login_email: params.loginEmail,
    p_start_dates: params.startDates,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: { familyId: data } }
}

export async function rejectRegistration(submissionId: string, reason: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('reject_registration', {
    p_submission_id: submissionId,
    p_reason: reason.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
