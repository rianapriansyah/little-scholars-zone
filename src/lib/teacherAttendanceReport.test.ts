import { describe, expect, it } from 'vitest'
import { currentMonthRange, formatHoursMinutes, summarizeAttendanceByClass, weekdaysInRange } from './teacherAttendanceReport'
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
    { classroomTeacherId: 'a', classroomLabel: 'Kelas A' },
    { classroomTeacherId: 'b', classroomLabel: 'Kelas B' },
  ]

  it('sums minutes per class and grand total, counting only cells within `dates`', () => {
    const dates = ['2026-08-03', '2026-08-04']
    const rows = [
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: 45 }),
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-04', minutesTaught: 50 }),
      fakeRow({ classroomTeacherId: 'b', sessionDate: '2026-08-03', minutesTaught: 30 }),
    ]

    const result = summarizeAttendanceByClass(classes, dates, rows)

    expect(result.classTotals).toEqual([
      { classroomTeacherId: 'a', classroomLabel: 'Kelas A', totalMinutes: 95 },
      { classroomTeacherId: 'b', classroomLabel: 'Kelas B', totalMinutes: 30 },
    ])
    expect(result.grandTotalMinutes).toBe(125)
  })

  it('ignores a row whose date is not in the weekday list — this is the bug that caused MyAttendancePage and the PDF to disagree', () => {
    const dates = ['2026-08-03'] // Monday only; 2026-08-01 is a Saturday
    const rows = [
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: 45 }),
      fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-01', minutesTaught: 5 }),
    ]

    const result = summarizeAttendanceByClass([classes[0]], dates, rows)

    expect(result.grandTotalMinutes).toBe(45)
  })

  it('treats a null minutesTaught as zero rather than NaN', () => {
    const dates = ['2026-08-03']
    const rows = [fakeRow({ classroomTeacherId: 'a', sessionDate: '2026-08-03', minutesTaught: null })]

    const result = summarizeAttendanceByClass([classes[0]], dates, rows)

    expect(result.grandTotalMinutes).toBe(0)
  })

  it('gives a class with no attendance rows at all a total of zero', () => {
    const result = summarizeAttendanceByClass(classes, ['2026-08-03'], [])
    expect(result.classTotals).toEqual([
      { classroomTeacherId: 'a', classroomLabel: 'Kelas A', totalMinutes: 0 },
      { classroomTeacherId: 'b', classroomLabel: 'Kelas B', totalMinutes: 0 },
    ])
    expect(result.grandTotalMinutes).toBe(0)
  })
})
