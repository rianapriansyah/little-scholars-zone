import { describe, expect, it } from 'vitest'
import { currentMonthRange, weekdaysInRange } from './teacherAttendanceReport'

describe('currentMonthRange', () => {
  it('returns the first and last day of the month, and an Indonesian label', () => {
    expect(currentMonthRange('2026-08-09')).toEqual({
      start: '2026-08-01',
      end: '2026-08-31',
      label: 'Agustus 2026',
    })
  })

  it('handles a short month correctly', () => {
    expect(currentMonthRange('2026-02-15')).toEqual({
      start: '2026-02-01',
      end: '2026-02-28',
      label: 'Februari 2026',
    })
  })

  it('defaults to today when no reference date is given', () => {
    const result = currentMonthRange()
    expect(result.start.slice(8)).toBe('01')
    expect(result.label).toMatch(/\d{4}$/)
  })
})

describe('weekdaysInRange', () => {
  it('excludes Saturday and Sunday', () => {
    // 2026-08-01 is a Saturday, 2026-08-02 a Sunday (2026-08-03 is the Monday used elsewhere).
    expect(weekdaysInRange('2026-08-01', '2026-08-07')).toEqual([
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
      '2026-08-06',
      '2026-08-07',
    ])
  })

  it('is inclusive of both endpoints when they are weekdays', () => {
    expect(weekdaysInRange('2026-08-03', '2026-08-03')).toEqual(['2026-08-03'])
  })

  it('returns an empty list for a weekend-only range', () => {
    expect(weekdaysInRange('2026-08-01', '2026-08-02')).toEqual([])
  })
})
