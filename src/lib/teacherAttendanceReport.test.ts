import { describe, expect, it } from 'vitest'
import {
  currentMonthRange,
  formatHoursMinutes,
  isWeekendDate,
  reportDatesInRange,
  summarizeAttendanceByClass,
} from './teacherAttendanceReport'
import type { ClassroomTeacherAttendanceStatus } from '../types/classroomTeacherAttendance'

/** Only classroomTeacherId/sessionDate/minutesTaught matter to summarizeAttendanceByClass;
 * everything else is filler to satisfy the type. */
function fakeRow(
  overrides: Pick<ClassroomTeacherAttendanceStatus, 'classroomTeacherId' | 'sessionDate' | 'minutesTaught'>,
): ClassroomTeacherAttendanceStatus {
  return {
    id: `${overrides.classroomTeacherId}-${overrides.sessionDate}`,
    clockedInAt: null,
    clockedInSource: null,
    clockedOutAt: null,
    clockedOutSource: null,
    editedBy: null,
    notes: null,
    scheduledStart: `${overrides.sessionDate}T00:00:00Z`,
    scheduledEnd: `${overrides.sessionDate}T00:00:00Z`,
    workSessionCount: 0,
    arrivalStatus: 'on_time',
    departureStatus: 'on_time',
    ...overrides,
  }
}

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

describe('reportDatesInRange', () => {
  it('includes every day, weekends too', () => {
    // 2026-08-01 is a Saturday, 2026-08-02 a Sunday.
    expect(reportDatesInRange('2026-08-01', '2026-08-04')).toEqual([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
    ])
  })

  it('is inclusive of both endpoints', () => {
    expect(reportDatesInRange('2026-08-03', '2026-08-03')).toEqual(['2026-08-03'])
  })

  it('covers a whole month', () => {
    expect(reportDatesInRange('2026-11-01', '2026-11-30')).toHaveLength(30)
  })
})

describe('isWeekendDate', () => {
  it('is true only for Saturday and Sunday', () => {
    expect(isWeekendDate('2026-08-01')).toBe(true) // Saturday
    expect(isWeekendDate('2026-08-02')).toBe(true) // Sunday
    expect(isWeekendDate('2026-08-03')).toBe(false) // Monday
    expect(isWeekendDate('2026-08-07')).toBe(false) // Friday
  })
})

describe('formatHoursMinutes', () => {
  it('omits the minutes when there is no remainder', () => {
    expect(formatHoursMinutes(2400)).toBe('40 jam')
  })

  it('shows the leftover minutes otherwise', () => {
    expect(formatHoursMinutes(907)).toBe('15 jam 7 menit')
  })

  it('handles zero', () => {
    expect(formatHoursMinutes(0)).toBe('0 jam')
  })

  it('handles less than an hour', () => {
    expect(formatHoursMinutes(45)).toBe('0 jam 45 menit')
  })
})

describe('summarizeAttendanceByClass', () => {
  const classes = [
    { classroomTeacherId: 'a', classroomLabel: 'Kelas A', rate: 8000 },
    { classroomTeacherId: 'b', classroomLabel: 'Kelas B', rate: 10000 },
  ]

  /** A single Monday — enough for the tests that are about money, not about which days count. */
  const monday = { start: '2026-08-03', end: '2026-08-03' }

  it('sums minutes per class and grand total over the period', () => {
    const dates = { start: '2026-08-03', end: '2026-08-04' }
    const rows = [
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: 45 }),
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-04', minutesTaught: 50 }),
      fakeRow({ classroomTeacherId: 'b', sessionDate: '2026-08-03', minutesTaught: 30 }),
    ]

    const result = summarizeAttendanceByClass(classes, dates, rows)

    expect(result.classTotals).toEqual([
      { classroomTeacherId: 'a', classroomLabel: 'Kelas A', rate: 8000, totalMinutes: 95, pay: (95 / 60) * 8000 },
      { classroomTeacherId: 'b', classroomLabel: 'Kelas B', rate: 10000, totalMinutes: 30, pay: (30 / 60) * 10000 },
    ])
    expect(result.grandTotalMinutes).toBe(125)
  })

  it('prices each class at its own rate rather than the grand total at one rate', () => {
    const rows = [
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: 60 }),
      fakeRow({ classroomTeacherId: 'b', sessionDate: '2026-08-03', minutesTaught: 60 }),
    ]

    const result = summarizeAttendanceByClass(classes, monday, rows)

    // 1h at 8.000 + 1h at 10.000. Multiplying the 2h total by either rate would be wrong.
    expect(result.estimatedPay).toBe(18000)
    expect(result.classesMissingRate).toEqual([])
  })

  it('leaves a class with no rate out of the money but keeps its minutes in the total', () => {
    const mixed = [
      { classroomTeacherId: 'a', classroomLabel: 'Kelas A', rate: 8000 },
      { classroomTeacherId: 'b', classroomLabel: 'Piket Pagi', rate: null },
    ]
    const rows = [
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: 60 }),
      fakeRow({ classroomTeacherId: 'b', sessionDate: '2026-08-03', minutesTaught: 30 }),
    ]

    const result = summarizeAttendanceByClass(mixed, monday, rows)

    expect(result.grandTotalMinutes).toBe(90)
    expect(result.estimatedPay).toBe(8000)
    // Named so an incomplete figure explains itself instead of reading as the whole month.
    expect(result.classesMissingRate).toEqual(['Piket Pagi'])
  })

  it('reports no estimate at all when nothing worked has a rate', () => {
    const unrated = [{ classroomTeacherId: 'a', classroomLabel: 'Kelas A', rate: null }]
    const rows = [fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: 60 })]

    const result = summarizeAttendanceByClass(unrated, monday, rows)

    // null, not 0 — "belum diatur" is a different statement from "earned nothing".
    expect(result.estimatedPay).toBeNull()
    expect(result.grandTotalMinutes).toBe(60)
  })

  it('does not name a rate-less class the teacher never worked', () => {
    const mixed = [
      { classroomTeacherId: 'a', classroomLabel: 'Kelas A', rate: 8000 },
      { classroomTeacherId: 'b', classroomLabel: 'Kelas B', rate: null },
    ]
    const rows = [fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: 60 })]

    const result = summarizeAttendanceByClass(mixed, monday, rows)

    expect(result.estimatedPay).toBe(8000)
    expect(result.classesMissingRate).toEqual([])
  })

  it('counts Saturday and Sunday — the days the PDF prints in red are days it totals', () => {
    // 2026-08-01 Saturday, 2026-08-02 Sunday, 2026-08-03 Monday.
    const rows = [
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-01', minutesTaught: 60 }),
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-02', minutesTaught: 30 }),
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: 45 }),
    ]

    const result = summarizeAttendanceByClass([classes[0]], { start: '2026-08-01', end: '2026-08-03' }, rows)

    expect(result.grandTotalMinutes).toBe(135)
    expect(result.estimatedPay).toBe((135 / 60) * 8000)
  })

  it('ignores a row outside the period', () => {
    const rows = [
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: 45 }),
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-07-31', minutesTaught: 5 }),
    ]

    const result = summarizeAttendanceByClass([classes[0]], monday, rows)

    expect(result.grandTotalMinutes).toBe(45)
  })

  it('treats a null minutesTaught as zero rather than NaN', () => {
    const rows = [fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: null })]

    const result = summarizeAttendanceByClass([classes[0]], monday, rows)

    expect(result.grandTotalMinutes).toBe(0)
  })

  it('gives a class with no attendance rows at all a total of zero', () => {
    const result = summarizeAttendanceByClass(classes, monday, [])
    expect(result.classTotals).toEqual([
      { classroomTeacherId: 'a', classroomLabel: 'Kelas A', rate: 8000, totalMinutes: 0, pay: 0 },
      { classroomTeacherId: 'b', classroomLabel: 'Kelas B', rate: 10000, totalMinutes: 0, pay: 0 },
    ])
    expect(result.grandTotalMinutes).toBe(0)
  })
})
