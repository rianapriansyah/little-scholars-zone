/**
 * Rupiah helpers, mirroring the car-rental app's src/lib/formatIdr.ts so amounts read and
 * behave the same across both projects.
 *
 * The formatter is built once at module load rather than per call — Intl.NumberFormat
 * construction is the expensive part, and these run inside grid cell renderers.
 */
const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
})

/** Display an amount, e.g. 500000 → "Rp 500.000". IDR has no minor units in everyday use. */
export function formatIdr(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  return idrFormatter.format(Math.round(amount))
}

/**
 * Group a raw digit string for display in a money input, e.g. "300000" → "300.000".
 * Input state holds the raw digits; this is only what the user sees.
 */
export function groupDigits(raw: string): string {
  if (!raw) return ''
  return raw.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

/** Strip everything but digits — what a money input stores as the user types. */
export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}
