import { describe, expect, it } from 'vitest'
import { NEAR_DUE_DAYS_REMAINING, selectNearDueChildren } from './nearDuePeriods'
import type { LearningPeriodListEntry } from '../types/attendance'

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
    daysConsumed: 18,
    daysSick: 0,
    daysRemaining: 2,
    isActive: true,
    childName: 'Aisyah',
    classroomLabel: 'Bimba',
    ...overrides,
  }
}

describe('selectNearDueChildren', () => {
  it('treats five days left as near due', () => {
    expect(NEAR_DUE_DAYS_REMAINING).toBe(5)
    expect(selectNearDueChildren([period({ id: 'a', daysRemaining: 5 })])).toHaveLength(1)
  })

  it('leaves out a child with six days left', () => {
    expect(selectNearDueChildren([period({ id: 'a', daysRemaining: 6 })])).toEqual([])
  })

  it('includes a period already out of days', () => {
    // record_attendance closes a period when the quota runs out, but until it does the child is
    // the most urgent thing on the list, not absent from it.
    const children = selectNearDueChildren([period({ id: 'a', daysRemaining: 0 })])
    expect(children[0].soonestDaysRemaining).toBe(0)
  })

  it('skips a closed period even when its count is low', () => {
    expect(selectNearDueChildren([period({ id: 'a', daysRemaining: 0, isActive: false, closedAt: '2026-10-01' })])).toEqual(
      [],
    )
  })

  it('lists only the near-due program of a child who holds two', () => {
    const children = selectNearDueChildren([
      period({ id: 'a', classroomId: 'class-1', classroomLabel: 'Bimba', daysRemaining: 2 }),
      period({ id: 'b', classroomId: 'class-2', classroomLabel: 'Calistung', daysRemaining: 18 }),
    ])
    expect(children).toHaveLength(1)
    expect(children[0].programs.map((p) => p.classroomLabel)).toEqual(['Bimba'])
    expect(children[0].soonestDaysRemaining).toBe(2)
  })

  it('keeps both programs when both are near due, most urgent first', () => {
    const children = selectNearDueChildren([
      period({ id: 'a', classroomId: 'class-1', classroomLabel: 'Bimba', daysRemaining: 4 }),
      period({ id: 'b', classroomId: 'class-2', classroomLabel: 'Calistung', daysRemaining: 1 }),
    ])
    expect(children[0].programs.map((p) => p.classroomLabel)).toEqual(['Calistung', 'Bimba'])
    expect(children[0].soonestDaysRemaining).toBe(1)
  })

  it('orders children by who runs out first', () => {
    const children = selectNearDueChildren([
      period({ id: 'a', childId: 'child-1', childName: 'Aisyah', daysRemaining: 4 }),
      period({ id: 'b', childId: 'child-2', childName: 'Bilal', daysRemaining: 1 }),
      period({ id: 'c', childId: 'child-3', childName: 'Cahaya', daysRemaining: 3 }),
    ])
    expect(children.map((c) => c.childName)).toEqual(['Bilal', 'Cahaya', 'Aisyah'])
  })

  it('breaks a tie on the child name, so the list is stable between loads', () => {
    const children = selectNearDueChildren([
      period({ id: 'a', childId: 'child-2', childName: 'Bilal', daysRemaining: 2 }),
      period({ id: 'b', childId: 'child-1', childName: 'Aisyah', daysRemaining: 2 }),
    ])
    expect(children.map((c) => c.childName)).toEqual(['Aisyah', 'Bilal'])
  })

  it('collapses two periods of the same program to its most pressing one', () => {
    // A renewal already filed: the open period is what is left to run out, not the spent one.
    const children = selectNearDueChildren([
      period({ id: 'a', periodNo: 1, isActive: false, closedAt: '2026-09-20', daysRemaining: 0 }),
      period({ id: 'b', periodNo: 2, daysRemaining: 3 }),
    ])
    expect(children).toHaveLength(1)
    expect(children[0].programs).toHaveLength(1)
    expect(children[0].soonestDaysRemaining).toBe(3)
  })

  it('honours an explicit threshold', () => {
    expect(selectNearDueChildren([period({ id: 'a', daysRemaining: 5 })], 3)).toEqual([])
    expect(selectNearDueChildren([period({ id: 'a', daysRemaining: 3 })], 3)).toHaveLength(1)
  })
})
