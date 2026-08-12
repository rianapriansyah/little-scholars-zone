import type { Database } from './database'

export type PaymentPeriodRow = Database['public']['Tables']['payment_periods']['Row']

/** Mirrors the payment_periods.status CHECK constraint. */
export const PAYMENT_STATUSES = ['unpaid', 'paid'] as const

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  unpaid: 'Belum Bayar',
  paid: 'Lunas',
}

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value)
}

/** payment_periods with `status` narrowed and every column named the way the UI wants it. */
export type PaymentPeriod = {
  id: string
  learningPeriodId: string
  registrationSubmissionId: string | null
  childId: string
  amount: number
  status: PaymentStatus
  dueDate: string | null
  paidAt: string | null
  receiptPath: string | null
  paymentNote: string | null
  createdAt: string
}

/** Narrows a raw table row. Returns null rather than throwing on an unrecognised status. */
export function parsePaymentPeriod(row: PaymentPeriodRow): PaymentPeriod | null {
  if (!isPaymentStatus(row.status)) return null
  return {
    id: row.id,
    learningPeriodId: row.learning_period_id,
    registrationSubmissionId: row.registration_submission_id,
    childId: row.child_id,
    amount: Number(row.amount),
    status: row.status,
    dueDate: row.due_date,
    paidAt: row.paid_at,
    receiptPath: row.receipt_path,
    paymentNote: row.payment_note,
    createdAt: row.created_at,
  }
}
