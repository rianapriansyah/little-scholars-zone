import { describe, expect, it } from 'vitest'
import { addAttendanceDateProblem, isPeriodQuotaFull, nextPeriodOf } from './addAttendanceChecks'

const p1 = { id: 'p1', periodNo: 1, startDate: '2026-09-22', actualEndDate: '2026-10-20' }
const p2 = { id: 'p2', periodNo: 2, startDate: '2026-10-21', actualEndDate: null }
const p3 = { id: 'p3', periodNo: 3, startDate: '2026-11-19', actualEndDate: null }
const all = [p3, p1, p2]

function problem(date: string, period: typeof p1 | typeof p2 | typeof p3, existingOn?: string) {
  return addAttendanceDateProblem({
    date,
    period,
    classPeriods: all,
    existing: existingOn ? { learning_period_id: existingOn } : null,
  })
}

describe('isPeriodQuotaFull', () => {
  it('is full once consumed reaches the guarantee', () => {
    expect(isPeriodQuotaFull({ daysConsumed: 19, guaranteedDays: 20 })).toBe(false)
    expect(isPeriodQuotaFull({ daysConsumed: 20, guaranteedDays: 20 })).toBe(true)
    expect(isPeriodQuotaFull({ daysConsumed: 21, guaranteedDays: 20 })).toBe(true)
  })
})

describe('nextPeriodOf', () => {
  it('picks the lowest higher period number regardless of order', () => {
    expect(nextPeriodOf(p1, all)).toBe(p2)
    expect(nextPeriodOf(p2, all)).toBe(p3)
    expect(nextPeriodOf(p3, all)).toBeNull()
  })
})

describe('addAttendanceDateProblem', () => {
  it('allows a free day inside a closed period, ends included', () => {
    expect(problem('2026-09-22', p1)).toBeNull()
    expect(problem('2026-10-19', p1)).toBeNull()
    expect(problem('2026-10-20', p1)).toBeNull()
  })

  it('refuses a day before the period starts', () => {
    expect(problem('2026-09-21', p1)).toBe('Tanggal ini sebelum Periode 1 dimulai (22-September-2026).')
  })

  it('refuses a day after the actual end date', () => {
    expect(problem('2026-10-21', p1)).toBe('Tanggal ini setelah Periode 1 selesai (20-Oktober-2026).')
  })

  it('without an actual end, stops the day before the next period starts', () => {
    expect(problem('2026-11-18', p2)).toBeNull()
    expect(problem('2026-11-19', p2)).toBe('Tanggal ini sudah masuk Periode 3, yang mulai 19-November-2026.')
  })

  it('has no end for the last open period', () => {
    expect(problem('2026-12-31', p3)).toBeNull()
  })

  it('refuses a day already recorded on another period, naming it', () => {
    expect(problem('2026-10-19', p1, 'p2')).toBe(
      'Tanggal ini sudah tercatat di Periode 2. Gunakan Pindahkan Absen bila perlu dipindah.',
    )
  })

  it('allows a day already recorded on this same period', () => {
    expect(problem('2026-10-19', p1, 'p1')).toBeNull()
  })

  it('still refuses when the owning period is not in the list', () => {
    expect(problem('2026-10-19', p1, 'gone')).toBe(
      'Tanggal ini sudah tercatat di periode lain. Gunakan Pindahkan Absen bila perlu dipindah.',
    )
  })
})
