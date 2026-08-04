import { describe, expect, it } from 'vitest'
import { consumesQuota, isNearingEnd, parseLearningPeriodStatus, summarizeAttendances } from './attendanceQuota'
import type { LearningPeriodStatusRow } from '../types/attendance'

describe('consumesQuota', () => {
  it('charges present and absent, but never sick', () => {
    expect(consumesQuota('present')).toBe(true)
    expect(consumesQuota('absent')).toBe(true)
    expect(consumesQuota('sick')).toBe(false)
  })
})

describe('summarizeAttendances', () => {
  it('counts present and absent against the quota and sick separately', () => {
    const summary = summarizeAttendances(
      [{ status: 'present' }, { status: 'absent' }, { status: 'sick' }, { status: 'present' }],
      20,
    )
    expect(summary).toEqual({ daysConsumed: 3, daysSick: 1, daysRemaining: 17 })
  })

  it('consumes nothing when no attendance rows exist — a holiday is the absence of rows', () => {
    expect(summarizeAttendances([], 20)).toEqual({ daysConsumed: 0, daysSick: 0, daysRemaining: 20 })
  })

  it('leaves the quota untouched for a period of nothing but sick days', () => {
    const summary = summarizeAttendances([{ status: 'sick' }, { status: 'sick' }], 20)
    expect(summary.daysConsumed).toBe(0)
    expect(summary.daysRemaining).toBe(20)
    expect(summary.daysSick).toBe(2)
  })

  it('reaches exactly zero remaining on the 20th consuming day', () => {
    const rows = Array.from({ length: 20 }, () => ({ status: 'present' }))
    expect(summarizeAttendances(rows, 20).daysRemaining).toBe(0)
  })

  it('ignores a status outside the known set rather than miscounting it', () => {
    expect(summarizeAttendances([{ status: 'holiday' }, { status: 'present' }], 20).daysConsumed).toBe(1)
  })
})

function viewRow(overrides: Partial<LearningPeriodStatusRow> = {}): LearningPeriodStatusRow {
  return {
    id: 'period-1',
    child_id: 'child-1',
    classroom_id: 'classroom-1',
    period_no: 1,
    start_date: '2026-09-01',
    projected_end_date: null,
    actual_end_date: null,
    guaranteed_days: 20,
    closed_at: null,
    created_at: '2026-09-01T00:00:00Z',
    created_by: null,
    days_consumed: 3,
    days_sick: 1,
    days_remaining: 17,
    is_active: true,
    ...overrides,
  }
}

describe('parseLearningPeriodStatus', () => {
  it('narrows the view row, which Postgrest types as all-nullable', () => {
    const parsed = parseLearningPeriodStatus(viewRow())
    expect(parsed).not.toBeNull()
    expect(parsed?.daysRemaining).toBe(17)
    expect(parsed?.isActive).toBe(true)
  })

  it('returns null when a required column is missing instead of throwing', () => {
    expect(parseLearningPeriodStatus(viewRow({ id: null }))).toBeNull()
    expect(parseLearningPeriodStatus(viewRow({ child_id: null }))).toBeNull()
    expect(parseLearningPeriodStatus(viewRow({ guaranteed_days: null }))).toBeNull()
  })

  it('falls back to guaranteed minus consumed if the view omits days_remaining', () => {
    const parsed = parseLearningPeriodStatus(viewRow({ days_remaining: null, days_consumed: 5 }))
    expect(parsed?.daysRemaining).toBe(15)
  })
})

describe('isNearingEnd', () => {
  it('flags a period at or under the threshold', () => {
    expect(isNearingEnd({ daysRemaining: 3 })).toBe(true)
    expect(isNearingEnd({ daysRemaining: 0 })).toBe(true)
    expect(isNearingEnd({ daysRemaining: 4 })).toBe(false)
  })
})
