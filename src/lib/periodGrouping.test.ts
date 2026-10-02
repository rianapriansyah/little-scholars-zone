import { describe, expect, it } from 'vitest'
import { groupPeriodsByChild, groupPeriodsByProgram, tallyPayments } from './periodGrouping'
import type { LearningPeriodListEntry } from '../types/attendance'
import type { PaymentStatus } from '../types/payment'

function period(overrides: Partial<LearningPeriodListEntry> & { id: string }): LearningPeriodListEntry {
  return {
    childId: 'child-1',
    classroomId: 'class-1',
    periodNo: 1,
    startDate: '2026-09-01',
    projectedEndDate: null,
    actualEndDate: null,
    guaranteedDays: 20,
    closedAt: null,
    daysConsumed: 0,
    daysSick: 0,
    daysRemaining: 20,
    isActive: true,
    childName: 'Aisyah',
    classroomLabel: 'Bimba',
    ...overrides,
  }
}

describe('groupPeriodsByProgram', () => {
  it('keeps two periods of the same classroom as one program', () => {
    const groups = groupPeriodsByProgram([
      period({ id: 'a', periodNo: 1, isActive: false, closedAt: '2026-09-20', daysRemaining: 0 }),
      period({ id: 'b', periodNo: 2, daysRemaining: 12 }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].classroomId).toBe('class-1')
    // Newest first, so the card leads with the period that is actually running.
    expect(groups[0].periods.map((p) => p.id)).toEqual(['b', 'a'])
    expect(groups[0].isActive).toBe(true)
    expect(groups[0].daysRemaining).toBe(12)
  })

  it('separates different classrooms, running ones first', () => {
    const groups = groupPeriodsByProgram([
      period({ id: 'a', classroomId: 'c-done', classroomLabel: 'English', isActive: false, daysRemaining: 0 }),
      period({ id: 'b', classroomId: 'c-open', classroomLabel: 'Bimba', daysRemaining: 5 }),
    ])

    expect(groups.map((g) => g.classroomLabel)).toEqual(['Bimba', 'English'])
    expect(groups[1].isActive).toBe(false)
    expect(groups[1].daysRemaining).toBeNull()
  })

  it('reports the most pressing open period when a program has several', () => {
    const groups = groupPeriodsByProgram([
      period({ id: 'a', periodNo: 1, daysRemaining: 9 }),
      period({ id: 'b', periodNo: 2, daysRemaining: 3 }),
    ])

    expect(groups[0].daysRemaining).toBe(3)
  })

  it('ignores a closed period when judging how soon a program runs out', () => {
    const groups = groupPeriodsByProgram([
      period({ id: 'a', periodNo: 1, isActive: false, daysRemaining: 0 }),
      period({ id: 'b', periodNo: 2, daysRemaining: 11 }),
    ])

    expect(groups[0].daysRemaining).toBe(11)
  })
})

describe('groupPeriodsByChild', () => {
  it('gives a child in two programs one row, not two', () => {
    const rows = groupPeriodsByChild([
      period({ id: 'a', classroomId: 'c1', classroomLabel: 'Bimba', daysRemaining: 8 }),
      period({ id: 'b', classroomId: 'c2', classroomLabel: 'English', daysRemaining: 15 }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].programs).toHaveLength(2)
    // The row's urgency is the soonest of the two, not the first one encountered.
    expect(rows[0].soonestDaysRemaining).toBe(8)
  })

  it('sorts whoever runs out first to the top', () => {
    const rows = groupPeriodsByChild([
      period({ id: 'a', childId: 'k1', childName: 'Aisyah', daysRemaining: 14 }),
      period({ id: 'b', childId: 'k2', childName: 'Bima', daysRemaining: 2 }),
      period({ id: 'c', childId: 'k3', childName: 'Citra', daysRemaining: 7 }),
    ])

    expect(rows.map((r) => r.childName)).toEqual(['Bima', 'Citra', 'Aisyah'])
  })

  it('sorts a child with nothing running last, however few days the closed period had', () => {
    const rows = groupPeriodsByChild([
      period({ id: 'a', childId: 'k1', childName: 'Aisyah', isActive: false, daysRemaining: 0 }),
      period({ id: 'b', childId: 'k2', childName: 'Bima', daysRemaining: 19 }),
    ])

    expect(rows.map((r) => r.childName)).toEqual(['Bima', 'Aisyah'])
    expect(rows[1].soonestDaysRemaining).toBeNull()
  })

  it('breaks a tie by name so the order does not shuffle between loads', () => {
    const rows = groupPeriodsByChild([
      period({ id: 'a', childId: 'k2', childName: 'Bima', daysRemaining: 5 }),
      period({ id: 'b', childId: 'k1', childName: 'Aisyah', daysRemaining: 5 }),
    ])

    expect(rows.map((r) => r.childName)).toEqual(['Aisyah', 'Bima'])
  })
})

describe('tallyPayments', () => {
  const rows = groupPeriodsByChild([
    period({ id: 'a', classroomId: 'c1', classroomLabel: 'Bimba' }),
    period({ id: 'b', classroomId: 'c2', classroomLabel: 'English' }),
  ])

  it('counts paid periods across every program', () => {
    const status = new Map<string, PaymentStatus>([['a', 'paid']])
    expect(tallyPayments(rows[0], status)).toEqual({ paid: 1, total: 2 })
  })

  it('counts a period with no payment row at all as unpaid', () => {
    expect(tallyPayments(rows[0], new Map())).toEqual({ paid: 0, total: 2 })
  })

  it('does not count an unpaid status as paid', () => {
    const status = new Map<string, PaymentStatus>([
      ['a', 'paid'],
      ['b', 'unpaid'],
    ])
    expect(tallyPayments(rows[0], status)).toEqual({ paid: 1, total: 2 })
  })
})
