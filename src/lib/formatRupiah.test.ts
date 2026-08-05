import { describe, expect, it } from 'vitest'
import { formatRupiah } from './formatRupiah'

describe('formatRupiah', () => {
  // Asserted loosely on separators: the exact space and grouping characters come from ICU and
  // are not worth pinning to one Node build.
  it('groups thousands and prefixes Rp', () => {
    expect(formatRupiah(500000)).toMatch(/^Rp\s?500[.,\s]000$/)
  })

  it('drops the cents rather than printing ,00', () => {
    expect(formatRupiah(350000.4)).toMatch(/^Rp\s?350[.,\s]000$/)
  })

  it('renders zero rather than an empty string, so an unpriced class is visible', () => {
    expect(formatRupiah(0)).toMatch(/^Rp\s?0$/)
  })

  it('falls back for a non-finite amount instead of printing NaN', () => {
    expect(formatRupiah(Number.NaN)).toBe('—')
  })
})
