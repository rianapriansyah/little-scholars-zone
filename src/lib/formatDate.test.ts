import { describe, expect, it } from 'vitest'
import dayjs from 'dayjs'
import { formatDate, formatDateTime } from './formatDate'

describe('formatDate', () => {
  it('writes an ISO date as DD-MMMM-YYYY with the Indonesian month', () => {
    expect(formatDate('2026-09-14')).toBe('14-September-2026')
  })

  it('pads the day to two digits', () => {
    expect(formatDate('2026-01-05')).toBe('05-Januari-2026')
  })

  it('covers every month name', () => {
    const months = Array.from({ length: 12 }, (_, i) => formatDate(`2026-${String(i + 1).padStart(2, '0')}-01`))
    expect(months).toEqual([
      '01-Januari-2026',
      '01-Februari-2026',
      '01-Maret-2026',
      '01-April-2026',
      '01-Mei-2026',
      '01-Juni-2026',
      '01-Juli-2026',
      '01-Agustus-2026',
      '01-September-2026',
      '01-Oktober-2026',
      '01-November-2026',
      '01-Desember-2026',
    ])
  })

  it('accepts a Dayjs as well as a string', () => {
    expect(formatDate(dayjs('2026-12-31'))).toBe('31-Desember-2026')
  })

  it('falls back rather than printing "Invalid Date" for empty or unparseable input', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('')).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('bukan tanggal')).toBe('—')
    expect(formatDate(null, '')).toBe('')
  })
})

describe('formatDateTime', () => {
  it('appends the wall-clock time to the date', () => {
    expect(formatDateTime('2026-09-14T08:05:00')).toBe('14-September-2026 08:05')
  })

  it('falls back on empty input', () => {
    expect(formatDateTime(null)).toBe('—')
  })
})
