import { describe, expect, it } from 'vitest'
import {
  classroomOptions,
  formatClassTimeRange,
  substituteBlockReason,
  teacherOptions,
  timeRangesOverlap,
} from './substitutionRules'
import type { SubstitutableClass } from '../types/substitution'

function entry(overrides: Partial<SubstitutableClass> = {}): SubstitutableClass {
  return {
    classroomTeacherId: 'ct-1',
    classroomId: 'c-1',
    classroomLabel: 'Kelas Pagi',
    timeStart: '08:00:00',
    timeEnd: '10:00:00',
    teacherId: 't-1',
    teacherName: 'Bu Rina',
    coveredByMe: false,
    otherSubstituteCount: 0,
    teacherClockedIn: false,
    studentCount: 6,
    ...overrides,
  }
}

describe('classroomOptions', () => {
  it('collapses several groups of one classroom into a single entry', () => {
    const options = classroomOptions([
      entry({ classroomTeacherId: 'a', teacherId: 't-1' }),
      entry({ classroomTeacherId: 'b', teacherId: 't-2' }),
    ])
    expect(options).toHaveLength(1)
    expect(options[0].classroomId).toBe('c-1')
  })

  it('orders classes by start time, then label', () => {
    const options = classroomOptions([
      entry({ classroomId: 'late', classroomLabel: 'Siang', timeStart: '13:00:00' }),
      entry({ classroomId: 'b', classroomLabel: 'B', timeStart: '08:00:00' }),
      entry({ classroomId: 'a', classroomLabel: 'A', timeStart: '08:00:00' }),
    ])
    expect(options.map((o) => o.classroomId)).toEqual(['a', 'b', 'late'])
  })

  it('returns nothing for an empty list', () => {
    expect(classroomOptions([])).toEqual([])
  })
})

describe('teacherOptions', () => {
  it('returns only the groups of the chosen classroom', () => {
    const teachers = teacherOptions(
      [
        entry({ classroomTeacherId: 'a', classroomId: 'c-1', teacherName: 'Bu Rina' }),
        entry({ classroomTeacherId: 'b', classroomId: 'c-2', teacherName: 'Bu Sari' }),
      ],
      'c-1',
    )
    expect(teachers.map((t) => t.classroomTeacherId)).toEqual(['a'])
  })

  it('lists every teacher holding a group in that classroom, by name', () => {
    const teachers = teacherOptions(
      [
        entry({ classroomTeacherId: 'b', teacherName: 'Bu Sari' }),
        entry({ classroomTeacherId: 'a', teacherName: 'Bu Ani' }),
      ],
      'c-1',
    )
    expect(teachers.map((t) => t.teacherName)).toEqual(['Bu Ani', 'Bu Sari'])
  })
})

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

  it('reports no overlap for disjoint schedules', () => {
    expect(timeRangesOverlap('08:00:00', '10:00:00', '13:00:00', '15:00:00')).toBe(false)
  })

  it('treats a class with no end time as having no extent', () => {
    expect(timeRangesOverlap('08:00:00', null, '08:00:00', '10:00:00')).toBe(false)
    expect(timeRangesOverlap('08:00:00', '10:00:00', '08:00:00', null)).toBe(false)
  })
})

describe('substituteBlockReason', () => {
  it('allows a free group that does not clash', () => {
    expect(substituteBlockReason(entry(), [{ classroomId: 'c-9', timeStart: '13:00:00', timeEnd: '15:00:00' }])).toBeNull()
  })

  it('does not block a group another teacher is also covering', () => {
    // The absent teacher's children are split between whoever is left, so a second and third
    // substitute on one group is the ordinary case, not a takeover.
    expect(substituteBlockReason(entry({ otherSubstituteCount: 2 }), [])).toBeNull()
  })

  it('blocks a group whose own teacher has clocked in', () => {
    expect(substituteBlockReason(entry({ teacherClockedIn: true }), [])).toBe('teacher_present')
  })

  it('blocks a group that clashes with a class she already holds', () => {
    expect(
      substituteBlockReason(entry(), [{ classroomId: 'c-9', timeStart: '09:00:00', timeEnd: '11:00:00' }]),
    ).toBe('overlaps_own_class')
  })

  it('never blocks the group she is already covering', () => {
    // She declared it earlier today; the screen takes her to the students, it does not grey it out.
    const mine = entry({ coveredByMe: true, otherSubstituteCount: 1, teacherClockedIn: true })
    expect(substituteBlockReason(mine, [{ classroomId: 'c-9', timeStart: '09:00:00', timeEnd: '11:00:00' }])).toBeNull()
  })

  it('does not call a second group of the same classroom a clash', () => {
    // Case 1: she teaches her own six in this very classroom and takes the absent teacher's six as
    // well. Same room, same hour, deliberately allowed.
    expect(
      substituteBlockReason(entry(), [{ classroomId: 'c-1', timeStart: '08:00:00', timeEnd: '10:00:00' }]),
    ).toBeNull()
  })

  it('does not treat a back-to-back class as a clash', () => {
    expect(
      substituteBlockReason(entry(), [{ classroomId: 'c-9', timeStart: '10:00:00', timeEnd: '12:00:00' }]),
    ).toBeNull()
  })

  it('still blocks a clash even when others are covering that group', () => {
    const reason = substituteBlockReason(entry({ otherSubstituteCount: 1 }), [
      { classroomId: 'c-9', timeStart: '09:00:00', timeEnd: '11:00:00' },
    ])
    expect(reason).toBe('overlaps_own_class')
  })
})

describe('formatClassTimeRange', () => {
  it('formats a full range', () => {
    expect(formatClassTimeRange('08:00:00', '10:00:00')).toBe('08:00–10:00')
  })

  it('omits the dash when there is no end time', () => {
    expect(formatClassTimeRange('08:00:00', null)).toBe('08:00')
  })
})
