import { supabase } from './supabase'
import type { Result } from './result'
import { uploadReceiptDirect } from './receiptStorage'
import { parsePaymentPeriod } from '../types/payment'
import type { PaymentPeriod, PaymentPeriodRow } from '../types/payment'

/** The row auto-created by learning_periods_create_payment_period the moment a period exists. */
export async function fetchPaymentPeriodForLearningPeriod(
  learningPeriodId: string,
): Promise<Result<PaymentPeriod | null>> {
  const { data, error } = await supabase
    .from('payment_periods')
    .select('*')
    .eq('learning_period_id', learningPeriodId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: true, data: null }

  const parsed = parsePaymentPeriod(data)
  if (!parsed) return { ok: false, error: 'Data pembayaran tidak lengkap.' }
  return { ok: true, data: parsed }
}

/**
 * learning_period_id → its payment_period, for merging payment info onto a list of periods
 * already fetched elsewhere (e.g. PeriodsPage's DataGrid) without a per-row round trip.
 */
export async function fetchPaymentPeriodsByLearningPeriodIds(
  learningPeriodIds: string[],
): Promise<Result<Map<string, PaymentPeriod>>> {
  if (learningPeriodIds.length === 0) return { ok: true, data: new Map() }

  const { data, error } = await supabase.from('payment_periods').select('*').in('learning_period_id', learningPeriodIds)
  if (error) return { ok: false, error: error.message }

  const byLearningPeriodId = new Map<string, PaymentPeriod>()
  for (const row of data ?? []) {
    const parsed = parsePaymentPeriod(row)
    if (parsed) byLearningPeriodId.set(parsed.learningPeriodId, parsed)
  }
  return { ok: true, data: byLearningPeriodId }
}

/** Embedded names Postgrest returns alongside a payment_periods row for the admin queue/tab. */
type PaymentPeriodWithNames = PaymentPeriodRow & {
  children: { full_name: string } | null
  learning_periods: { period_no: number; classrooms: { label: string } | null } | null
}

export type PaymentPeriodListEntry = PaymentPeriod & {
  childName: string
  classroomLabel: string
  periodNo: number
}

function toListEntry(row: PaymentPeriodWithNames): PaymentPeriodListEntry | null {
  const parsed = parsePaymentPeriod(row)
  if (!parsed) return null
  return {
    ...parsed,
    childName: row.children?.full_name ?? '—',
    classroomLabel: row.learning_periods?.classrooms?.label ?? '—',
    periodNo: row.learning_periods?.period_no ?? 0,
  }
}

/** Admin billing queue: every unpaid invoice, oldest due date first. */
export async function fetchUnpaidPaymentPeriods(): Promise<Result<PaymentPeriodListEntry[]>> {
  const { data, error } = await supabase
    .from('payment_periods')
    .select('*, children(full_name), learning_periods(period_no, classrooms(label))')
    .eq('status', 'unpaid')
    .order('due_date', { ascending: true, nullsFirst: false })
  if (error) return { ok: false, error: error.message }

  const entries: PaymentPeriodListEntry[] = []
  for (const row of (data ?? []) as unknown as PaymentPeriodWithNames[]) {
    const entry = toListEntry(row)
    if (entry) entries.push(entry)
  }
  return { ok: true, data: entries }
}

/** Every invoice for one child, newest first — the family tab's payment column. */
export async function fetchPaymentPeriodsForChild(childId: string): Promise<Result<PaymentPeriodListEntry[]>> {
  const { data, error } = await supabase
    .from('payment_periods')
    .select('*, children(full_name), learning_periods(period_no, classrooms(label))')
    .eq('child_id', childId)
    .order('created_at', { ascending: false })
  if (error) return { ok: false, error: error.message }

  const entries: PaymentPeriodListEntry[] = []
  for (const row of (data ?? []) as unknown as PaymentPeriodWithNames[]) {
    const entry = toListEntry(row)
    if (entry) entries.push(entry)
  }
  return { ok: true, data: entries }
}

/** Admin-only. Stamps paid_at and flips status in one step so the two can never disagree. */
export async function markPaymentPeriodPaid(paymentPeriodId: string, note?: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('mark_payment_period_paid', {
    p_payment_period_id: paymentPeriodId,
    p_note: note?.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

/** Reverts a mistaken "Tandai Lunas" — a plain update under admin_all_payment_periods. */
export async function markPaymentPeriodUnpaid(paymentPeriodId: string): Promise<Result<void>> {
  const { error } = await supabase
    .from('payment_periods')
    .update({ status: 'unpaid', paid_at: null })
    .eq('id', paymentPeriodId)
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

export async function updatePaymentPeriodDueDate(paymentPeriodId: string, dueDate: string | null): Promise<Result<void>> {
  const { error } = await supabase.from('payment_periods').update({ due_date: dueDate || null }).eq('id', paymentPeriodId)
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

export async function updatePaymentPeriodNote(paymentPeriodId: string, note: string): Promise<Result<void>> {
  const { error } = await supabase
    .from('payment_periods')
    .update({ payment_note: note.trim() || null })
    .eq('id', paymentPeriodId)
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

/**
 * Admin-uploaded, history only — attaching a receipt never changes `status`. Path is scoped
 * under the payment period's own id so re-uploads for different invoices can never collide.
 */
export async function uploadPaymentReceipt(paymentPeriodId: string, file: File): Promise<Result<void>> {
  const ext = file.name.includes('.') ? file.name.split('.').pop() : null
  const path = `payment-periods/${paymentPeriodId}/${crypto.randomUUID()}${ext ? `.${ext}` : ''}`

  const uploadResult = await uploadReceiptDirect(path, file)
  if (!uploadResult.ok) return uploadResult

  const { error } = await supabase.from('payment_periods').update({ receipt_path: path }).eq('id', paymentPeriodId)
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
