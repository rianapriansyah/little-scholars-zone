/**
 * Rupiah amounts for display. IDR has no minor units in everyday use, so cents are rounded
 * away rather than shown as ",00" on every price.
 */
export function formatRupiah(amount: number): string {
  if (!Number.isFinite(amount)) return '—'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount)
}
