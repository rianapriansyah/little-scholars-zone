import { describe, expect, it } from 'vitest'
import {
  defaultCountsForPay,
  sortTeachingGroups,
  substituteBlockReason,
  teachingGroupLabel,
  timeRangesOverlap,
} from './substitutionRules'
import type { SubstitutableGroup, TeachingGroup } from '../types/substitution'

function group(overrides: Partial<TeachingGroup> = {}): TeachingGroup {
  return {
    classroomTeacherId: 'ct-1',
    classroomId: 'c-1',
    label: 'Kelas Pagi',
    timeStart: '08:00:00',
    timeEnd: '10:00:00',
    isSubstitute: false,
    assignedTeacherName: null,
    ...overrides,
  }
}

function candidate(overrides: Partial<SubstitutableGroup> = {}): SubstitutableGroup {
  return {
    classroomTeacherId: 'ct-9',
    classroomId: 'c-9',
    label: 'Kelas Pagi B',
    timeStart: '08:00:00',
    timeEnd: '10:00:00',
    assignedTeacherName: 'Bu Rina',
    alreadyCovered: false,
    assignedTeacherClockedIn: false,
    ...overrides,
  }
}

describe('timeRangesOverlap', () => {
  it('finds an overlap when one class starts inside another', () => {
    expect(timeRangesOverlap('08:00:00', '10:00:00', '09:00:00', '11:00:00')).toBe(true)
  })

  it('treats back-to-back classes as not overlapping', () => {
    expect(timeRangesOverlap('08:00:00', '10:00:00', '10:00:00', '12:00:00')).toBe(false)
  })

  it('finds an overlap for identical schedules', () => {
    expect(timeRangesOverlap('08:00:00', '10:00:00', '08:00:00', '10:00:00')).toBe(true)
  })

  it('finds an overlap when one class fully contains another', () => {
    expect(timeRangesOverlap('08:00:00', '12:00:00', '09:00:00', '10:00:00')).toBe(true)
  })

  it('reports no overlap for disjoint schedules', () => {
    expect(timeRangesOverlap('08:00:00', '10:00:00', '13:00:00', '15:00:00')).toBe(false)
  })

  it('treats a class with no end time as having no extent', () => {
    expect(timeRangesOverlap('08:00:00', null, '08:00:00', '10:00:00')).toBe(false)
    expect(timeRangesOverlap('08:00:00', '10:00:00', '08:00:00', null)).toBe(false)
  })
})

describe('defaultCountsForPay', () => {
  it('does not pay a teacher who already holds a group in that classroom', () => {
    expect(defaultCountsForPay(['c-1', 'c-2'], 'c-1')).toBe(false)
  })

  it('pays a teacher coming in from outside the classroom', () => {
    expect(defaultCountsForPay(['c-2'], 'c-1')).toBe(true)
  })

  it('pays a teacher who holds no groups at all', () => {
    expect(defaultCountsForPay([], 'c-1')).toBe(true)
  })
})

describe('substituteBlockReason', () => {
  it('allows a free group that does not clash', () => {
    expect(substituteBlockReason(candidate(), [group({ timeStart: '13:00:00', timeEnd: '15:00:00' })])).toBeNull()
  })

  it('blocks a group someone else already covers', () => {
    expect(substituteBlockReason(candidate({ alreadyCovered: true }), [])).toBe('already_covered')
  })

  it('blocks a group whose own teacher has clocked in', () => {
    expect(substituteBlockReason(candidate({ assignedTeacherClockedIn: true }), [])).toBe(
      'assigned_teacher_present',
    )
  })

  it('blocks a group that clashes with a class she already holds', () => {
    expect(substituteBlockReason(candidate(), [group({ timeStart: '09:00:00', timeEnd: '11:00:00' })])).toBe(
      'overlaps_own_class',
    )
  })

  it('prefers the already-covered reason over a clash, as the more specific answer', () => {
    const reason = substituteBlockReason(candidate({ alreadyCovered: true }), [
      group({ timeStart: '09:00:00', timeEnd: '11:00:00' }),
    ])
    expect(reason).toBe('already_covered')
  })

  it('does not call a second group in the same classroom a clash', () => {
    // The whole point of case 1: she teaches her own six in this very classroom and takes the
    // absent teacher's six as well. Same room, same hour, deliberately allowed.
    const own = group({ classroomId: 'c-9', timeStart: '08:00:00', timeEnd: '10:00:00' })
    expect(substituteBlockReason(candidate({ classroomId: 'c-9' }), [own])).toBeNull()
  })

  it('does not treat a back-to-back class as a clash', () => {
    expect(substituteBlockReason(candidate(), [group({ timeStart: '10:00:00', timeEnd: '12:00:00' })])).toBeNull()
  })
})

describe('teachingGroupLabel', () => {
  it('shows label and time range for an own class', () => {
    expect(teachingGroupLabel(group())).toBe('Kelas Pagi · 08:00–10:00')
  })

  it('names the absent teacher for a covered class', () => {
    const covered = group({ isSubstitute: true, assignedTeacherName: 'Bu Rina' })
    expect(teachingGroupLabel(covered)).toBe('Kelas Pagi · 08:00–10:00 · Pengganti Bu Rina')
  })

  it('still marks coverage when the absent teacher has no name left', () => {
    const covered = group({ isSubstitute: true, assignedTeacherName: null })
    expect(teachingGroupLabel(covered)).toBe('Kelas Pagi · 08:00–10:00 · Pengganti')
  })

  it('omits the dash when the class has no end time', () => {
    expect(teachingGroupLabel(group({ timeEnd: null }))).toBe('Kelas Pagi · 08:00')
  })
})

describe('sortTeachingGroups', () => {
  it('puts own classes before covered ones', () => {
    const sorted = sortTeachingGroups([
      group({ classroomTeacherId: 'sub', timeStart: '07:00:00', isSubstitute: true }),
      group({ classroomTeacherId: 'mine', timeStart: '13:00:00' }),
    ])
    expect(sorted.map((g) => g.classroomTeacherId)).toEqual(['mine', 'sub'])
  })

  it('orders within each half by start time, then label', () => {
    const sorted = sortTeachingGroups([
      group({ classroomTeacherId: 'b', timeStart: '10:00:00', label: 'B' }),
      group({ classroomTeacherId: 'a', timeStart: '08:00:00', label: 'A' }),
      group({ classroomTeacherId: 'c', timeStart: '10:00:00', label: 'A' }),
    ])
    expect(sorted.map((g) => g.classroomTeacherId)).toEqual(['a', 'c', 'b'])
  })

  it('drops a duplicate group id', () => {
    const sorted = sortTeachingGroups([group(), group({ isSubstitute: true })])
    expect(sorted).toHaveLength(1)
    expect(sorted[0].isSubstitute).toBe(false)
  })

  it('returns an empty list unchanged', () => {
    expect(sortTeachingGroups([])).toEqual([])
  })
})
