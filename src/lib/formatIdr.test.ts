import { describe, expect, it } from 'vitest'
import { digitsOnly, formatIdr, groupDigits } from './formatIdr'

describe('formatIdr', () => {
  // Asserted loosely on separators: the exact space and grouping characters come from ICU and
  // are not worth pinning to one Node build.
  it('groups thousands and prefixes Rp', () => {
    expect(formatIdr(500000)).toMatch(/^Rp\s?500[.,\s]000$/)
  })

  it('rounds away the cents rather than printing ,00', () => {
    expect(formatIdr(350000.4)).toMatch(/^Rp\s?350[.,\s]000$/)
  })

  it('renders zero rather than an empty string, so an unpriced class is visible', () => {
    expect(formatIdr(0)).toMatch(/^Rp\s?0$/)
  })

  it('falls back for a non-finite amount instead of printing NaN', () => {
    expect(formatIdr(Number.NaN)).toBe('—')
  })
})

describe('groupDigits', () => {
  it('inserts a dot every three digits from the right', () => {
    expect(groupDigits('300000')).toBe('300.000')
    expect(groupDigits('1500000')).toBe('1.500.000')
  })

  it('leaves short numbers alone', () => {
    expect(groupDigits('0')).toBe('0')
    expect(groupDigits('999')).toBe('999')
  })

  it('returns empty for empty, so a cleared field stays cleared', () => {
    expect(groupDigits('')).toBe('')
  })
})

describe('digitsOnly', () => {
  it('strips separators the user typed or pasted', () => {
    expect(digitsOnly('Rp 1.500.000')).toBe('1500000')
    expect(digitsOnly('350,000')).toBe('350000')
  })

  it('drops a minus sign, so a price can never go negative through the input', () => {
    expect(digitsOnly('-5000')).toBe('5000')
  })
})
