import { describe, expect, it } from 'vitest'
import {
  buildContiguousChainLinks,
  findIncompleteTeacherAttendance,
  groupAttendanceByTeacher,
} from './classroomTeacherAttendance'
import type { ClassroomTeacherAttendanceListEntry, ClassroomTeacherAttendanceStatus } from '../types/classroomTeacherAttendance'

function status(overrides: Partial<ClassroomTeacherAttendanceStatus> = {}): ClassroomTeacherAttendanceStatus {
  return {
    id: 's1',
    classroomTeacherId: 'ct1',
    sessionDate: '2026-07-14',
    clockedInAt: null,
    clockedInSource: null,
    clockedOutAt: null,
    clockedOutSource: null,
    editedBy: null,
    notes: null,
    scheduledStart: '2026-07-14T02:00:00Z',
    scheduledEnd: '2026-07-14T04:00:00Z',
    minutesTaught: null,
    arrivalStatus: 'missing',
    departureStatus: 'missing',
    ...overrides,
  }
}

function entry(overrides: Partial<ClassroomTeacherAttendanceListEntry> = {}): ClassroomTeacherAttendanceListEntry {
  return {
    classroomTeacherId: 'ct1',
    teacherId: 't1',
    classroomLabel: 'Kelas Bintang',
    teacherName: 'Bu Rina',
    teacherRate: null,
    timeStart: '08:00:00',
    timeEnd: '10:00:00', // 2026-07-14T02:00:00Z in WITA
    status: null,
    ...overrides,
  }
}

describe('buildContiguousChainLinks', () => {
  it('links two classes with no gap between them', () => {
    const links = buildContiguousChainLinks([
      { classroomTeacherId: 'a', timeStart: '08:00:00', timeEnd: '10:00:00' },
      { classroomTeacherId: 'b', timeStart: '10:00:00', timeEnd: '12:00:00' },
    ])
    expect(links).toEqual([{ fromClassroomTeacherId: 'a', toClassroomTeacherId: 'b' }])
  })

  it('does not link classes with a gap between them', () => {
    // 12:00 -> 13:30 is a lunch break, not a back-to-back boundary.
    const links = buildContiguousChainLinks([
      { classroomTeacherId: 'b', timeStart: '10:00:00', timeEnd: '12:00:00' },
      { classroomTeacherId: 'c', timeStart: '13:30:00', timeEnd: '15:30:00' },
    ])
    expect(links).toEqual([])
  })

  it("handles Miss Amy's full day: two contiguous pairs separated by a lunch gap", () => {
    const links = buildContiguousChainLinks([
      { classroomTeacherId: 'class1', timeStart: '08:00:00', timeEnd: '10:00:00' },
      { classroomTeacherId: 'class2', timeStart: '10:00:00', timeEnd: '12:00:00' },
      { classroomTeacherId: 'class3', timeStart: '13:30:00', timeEnd: '15:30:00' },
      { classroomTeacherId: 'class4', timeStart: '15:30:00', timeEnd: '17:30:00' },
    ])
    expect(links).toEqual([
      { fromClassroomTeacherId: 'class1', toClassroomTeacherId: 'class2' },
      { fromClassroomTeacherId: 'class3', toClassroomTeacherId: 'class4' },
    ])
  })

  it('is independent of input order', () => {
    const links = buildContiguousChainLinks([
      { classroomTeacherId: 'b', timeStart: '10:00:00', timeEnd: '12:00:00' },
      { classroomTeacherId: 'a', timeStart: '08:00:00', timeEnd: '10:00:00' },
    ])
    expect(links).toEqual([{ fromClassroomTeacherId: 'a', toClassroomTeacherId: 'b' }])
  })

  it('returns nothing for a single class', () => {
    expect(buildContiguousChainLinks([{ classroomTeacherId: 'a', timeStart: '08:00:00', timeEnd: '10:00:00' }])).toEqual(
      [],
    )
  })

  it('returns nothing for an empty list', () => {
    expect(buildContiguousChainLinks([])).toEqual([])
  })
})

describe('groupAttendanceByTeacher', () => {
  it('collapses multiple classes under one teacher', () => {
    const groups = groupAttendanceByTeacher([
      entry({ classroomTeacherId: 'ct1', classroomLabel: 'Kelas Bintang' }),
      entry({ classroomTeacherId: 'ct2', classroomLabel: 'Kelas Bulan' }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].classes.map((c) => c.classroomLabel)).toEqual(['Kelas Bintang', 'Kelas Bulan'])
  })

  it('sorts teachers by name', () => {
    const groups = groupAttendanceByTeacher([
      entry({ teacherId: 't2', teacherName: 'Bu Sari' }),
      entry({ teacherId: 't1', teacherName: 'Bu Rina' }),
    ])
    expect(groups.map((g) => g.teacherName)).toEqual(['Bu Rina', 'Bu Sari'])
  })

  it('returns nothing for an empty roster', () => {
    expect(groupAttendanceByTeacher([])).toEqual([])
  })
})

describe('findIncompleteTeacherAttendance', () => {
  // 2026-07-14 is a Tuesday in WITA. timeEnd '10:00:00' -> 2026-07-14T02:00:00Z.
  const classEnded = new Date('2026-07-14T02:00:01Z') // 1s after the class ended
  const classStillRunning = new Date('2026-07-14T01:00:00Z') // 1h before it ends

  it('ignores a class that has not ended yet, even with no punches at all', () => {
    const result = findIncompleteTeacherAttendance([entry({ status: null })], classStillRunning)
    expect(result).toEqual([])
  })

  it('flags a class that ended with no clock-in at all as missing clock_in', () => {
    const result = findIncompleteTeacherAttendance([entry({ status: null })], classEnded)
    expect(result).toEqual([
      { teacherId: 't1', teacherName: 'Bu Rina', classes: [{ classroomTeacherId: 'ct1', classroomLabel: 'Kelas Bintang', missing: 'clock_in' }] },
    ])
  })

  it('flags a class that clocked in but never out as missing clock_out', () => {
    const result = findIncompleteTeacherAttendance(
      [entry({ status: status({ clockedInAt: '2026-07-14T02:00:00Z' }) })],
      classEnded,
    )
    expect(result[0].classes).toEqual([{ classroomTeacherId: 'ct1', classroomLabel: 'Kelas Bintang', missing: 'clock_out' }])
  })

  it('does not flag a fully clocked class', () => {
    const result = findIncompleteTeacherAttendance(
      [entry({ status: status({ clockedInAt: '2026-07-14T02:00:00Z', clockedOutAt: '2026-07-14T04:00:00Z' }) })],
      classEnded,
    )
    expect(result).toEqual([])
  })

  it('only lists the incomplete class among a teacher\'s several classes', () => {
    const result = findIncompleteTeacherAttendance(
      [
        entry({
          classroomTeacherId: 'ct1',
          classroomLabel: 'Kelas Bintang',
          status: status({ clockedInAt: '2026-07-14T02:00:00Z', clockedOutAt: '2026-07-14T04:00:00Z' }),
        }),
        entry({ classroomTeacherId: 'ct2', classroomLabel: 'Kelas Bulan', status: null }),
      ],
      classEnded,
    )
    expect(result).toHaveLength(1)
    expect(result[0].classes.map((c) => c.classroomLabel)).toEqual(['Kelas Bulan'])
  })

  it('is empty on a WITA weekend, since no class has a "today" end time to compare against', () => {
    const saturday = new Date('2026-07-18T04:00:00Z') // 12:00 WITA, Saturday
    const result = findIncompleteTeacherAttendance([entry({ status: null })], saturday)
    expect(result).toEqual([])
  })

  it('sorts flagged teachers by name', () => {
    const result = findIncompleteTeacherAttendance(
      [
        entry({ teacherId: 't2', teacherName: 'Bu Sari', classroomTeacherId: 'ct2', status: null }),
        entry({ teacherId: 't1', teacherName: 'Bu Rina', classroomTeacherId: 'ct1', status: null }),
      ],
      classEnded,
    )
    expect(result.map((r) => r.teacherName)).toEqual(['Bu Rina', 'Bu Sari'])
  })
})
