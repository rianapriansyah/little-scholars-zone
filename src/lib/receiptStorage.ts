import { supabase } from './supabase'
import type { Result } from './result'

/**
 * Shared by registration_submissions.receipt_path and payment_periods.receipt_path — both are
 * "proof of a payment" living in the same private `payment-receipts` bucket, so both go
 * through this one place instead of each hardcoding the bucket name.
 */
const RECEIPTS_BUCKET = 'payment-receipts'

/** Short-lived signed URL for a private receipt — admin only, per the storage policy. */
export async function fetchReceiptSignedUrl(receiptPath: string): Promise<Result<string>> {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(receiptPath, 60 * 10)
  if (error || !data) return { ok: false, error: error?.message ?? 'Gagal memuat bukti pembayaran.' }
  return { ok: true, data: data.signedUrl }
}

/**
 * Admin-side direct upload — unlike the public registration wizard (which has no session and
 * goes through submit-registration's signed-upload-URL dance), an admin is authenticated and
 * covered by admin_all_payment_receipts, so this can upload straight to Storage.
 */
export async function uploadReceiptDirect(path: string, file: File): Promise<Result<void>> {
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).upload(path, file, { upsert: true })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

/**
 * Called after delete_learning_period has already removed the payment_periods row that
 * referenced this file — Postgres can't reach into Storage itself, so the client does this
 * second step. Best-effort by design at the call site: the DB rows are already gone by the time
 * this runs, so a failure here just leaves an orphaned file in a private bucket, never a
 * dangling reference.
 */
export async function deletePaymentReceipt(path: string): Promise<Result<void>> {
  const { error } = await supabase.storage.from(RECEIPTS_BUCKET).remove([path])
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
