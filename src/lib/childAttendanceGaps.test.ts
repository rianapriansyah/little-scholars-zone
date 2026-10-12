import { describe, expect, it } from 'vitest'
import {
  groupGapsByTeacher,
  groupUnfilledAttendance,
  selectEndedClassAttendanceGaps,
  type ClassAttendanceGap,
  type ClassRosterRow,
} from './childAttendanceGaps'

/** A Monday, so the WITA weekday guard inside getTodaysClassEndInWita is satisfied. */
const DATE = '2026-10-12'

function row(overrides: Partial<ClassRosterRow> = {}): ClassRosterRow {
  return {
    classroomTeacherId: 'ct1',
    classroomId: 'c1',
    classroomLabel: 'Kelas Bintang',
    teacherId: 't1',
    teacherName: 'Bu Rina',
    teacherPhone: '081234567890',
    timeStart: '08:00:00',
    timeEnd: '10:00:00',
    childId: 'child1',
    childName: 'Adi',
    startedAt: '2026-09-01',
    hasCoveringPeriod: true,
    isFilled: false,
    ...overrides,
  }
}

describe('groupUnfilledAttendance', () => {
  it('lists a class with one child still unfilled', () => {
    const gaps = groupUnfilledAttendance([row()], DATE)
    expect(gaps).toHaveLength(1)
    expect(gaps[0].classroomLabel).toBe('Kelas Bintang')
    expect(gaps[0].teacherName).toBe('Bu Rina')
    expect(gaps[0].unfilled).toEqual([{ childId: 'child1', childName: 'Adi' }])
    expect(gaps[0].eligibleCount).toBe(1)
  })

  it('drops a class whose whole roster is already filled', () => {
    const gaps = groupUnfilledAttendance(
      [row({ isFilled: true }), row({ childId: 'child2', childName: 'Bima', isFilled: true })],
      DATE,
    )
    expect(gaps).toEqual([])
  })

  it('counts filled children in eligibleCount but not in unfilled', () => {
    const gaps = groupUnfilledAttendance(
      [row({ isFilled: true }), row({ childId: 'child2', childName: 'Bima' })],
      DATE,
    )
    expect(gaps[0].eligibleCount).toBe(2)
    expect(gaps[0].unfilled).toEqual([{ childId: 'child2', childName: 'Bima' }])
  })

  it('skips a child with no learning period covering the date', () => {
    // record_attendance would refuse the day, so it is not outstanding — it is impossible.
    const gaps = groupUnfilledAttendance([row({ hasCoveringPeriod: false })], DATE)
    expect(gaps).toEqual([])
  })

  it('skips a child who joined the group after the date', () => {
    const gaps = groupUnfilledAttendance([row({ startedAt: '2026-10-13' })], DATE)
    expect(gaps).toEqual([])
  })

  it('counts a child who joined on the date itself', () => {
    const gaps = groupUnfilledAttendance([row({ startedAt: DATE })], DATE)
    expect(gaps[0].unfilled).toHaveLength(1)
  })

  it('groups by teaching group, so two teachers in one classroom stay separate rows', () => {
    const gaps = groupUnfilledAttendance(
      [
        row(),
        row({
          classroomTeacherId: 'ct2',
          teacherId: 't2',
          teacherName: 'Bu Ayu',
          childId: 'child2',
          childName: 'Bima',
        }),
      ],
      DATE,
    )
    expect(gaps).toHaveLength(2)
    expect(gaps.map((g) => g.teacherName)).toEqual(['Bu Rina', 'Bu Ayu'])
  })

  it('orders classes by start time and children by name', () => {
    const gaps = groupUnfilledAttendance(
      [
        row({ classroomTeacherId: 'late', timeStart: '13:30:00', childId: 'child4', childName: 'Zaki' }),
        row({ childId: 'child3', childName: 'Citra' }),
        row({ childId: 'child2', childName: 'Bima' }),
        row(),
      ],
      DATE,
    )
    expect(gaps.map((g) => g.timeStart)).toEqual(['08:00:00', '13:30:00'])
    expect(gaps[0].unfilled.map((c) => c.childName)).toEqual(['Adi', 'Bima', 'Citra'])
  })
})

function gap(overrides: Partial<ClassAttendanceGap> = {}): ClassAttendanceGap {
  return {
    classroomTeacherId: 'ct1',
    classroomId: 'c1',
    classroomLabel: 'Kelas Bintang',
    teacherId: 't1',
    teacherName: 'Bu Rina',
    teacherPhone: '081234567890',
    timeStart: '08:00:00',
    timeEnd: '10:00:00',
    unfilled: [{ childId: 'child1', childName: 'Adi' }],
    eligibleCount: 1,
    ...overrides,
  }
}

describe('selectEndedClassAttendanceGaps', () => {
  // 11:00 WITA on Monday 2026-10-12: the 08:00–10:00 class is over, the 13:30–15:30 one has not
  // begun, and the 10:00–12:00 one is mid-session.
  const ELEVEN_WITA = new Date('2026-10-12T03:00:00Z')

  it('keeps a class whose scheduled end has passed', () => {
    expect(selectEndedClassAttendanceGaps([gap()], ELEVEN_WITA)).toHaveLength(1)
  })

  it('drops a class that has not started yet', () => {
    const upcoming = gap({ classroomTeacherId: 'ct2', timeStart: '13:30:00', timeEnd: '15:30:00' })
    expect(selectEndedClassAttendanceGaps([upcoming], ELEVEN_WITA)).toEqual([])
  })

  it('drops a class that is still running', () => {
    // Nothing has been missed yet — the teacher fills the roster once the class is over.
    const running = gap({ classroomTeacherId: 'ct3', timeStart: '10:00:00', timeEnd: '12:00:00' })
    expect(selectEndedClassAttendanceGaps([running], ELEVEN_WITA)).toEqual([])
  })

  it('keeps a class ending exactly now', () => {
    const justEnded = gap({ timeEnd: '11:00:00' })
    expect(selectEndedClassAttendanceGaps([justEnded], ELEVEN_WITA)).toHaveLength(1)
  })

  it('drops everything on a WITA weekend', () => {
    // Saturday 11:00 WITA. Classes only run Monday–Friday, so no roster is ever outstanding.
    expect(selectEndedClassAttendanceGaps([gap()], new Date('2026-10-17T03:00:00Z'))).toEqual([])
  })

  it('keeps only the ended classes out of a full day', () => {
    const kept = selectEndedClassAttendanceGaps(
      [
        gap(),
        gap({ classroomTeacherId: 'ct2', timeStart: '10:00:00', timeEnd: '12:00:00' }),
        gap({ classroomTeacherId: 'ct3', timeStart: '13:30:00', timeEnd: '15:30:00' }),
      ],
      ELEVEN_WITA,
    )
    expect(kept.map((g) => g.classroomTeacherId)).toEqual(['ct1'])
  })
})

describe('groupGapsByTeacher', () => {
  it('nests a teacher\'s classes under her, summing the students across them', () => {
    const groups = groupGapsByTeacher([
      gap(),
      gap({
        classroomTeacherId: 'ct2',
        classroomLabel: 'Kelas Pelangi',
        timeStart: '13:30:00',
        timeEnd: '15:30:00',
        unfilled: [
          { childId: 'child2', childName: 'Bima' },
          { childId: 'child3', childName: 'Citra' },
        ],
      }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].teacherName).toBe('Bu Rina')
    expect(groups[0].classes.map((c) => c.classroomLabel)).toEqual(['Kelas Bintang', 'Kelas Pelangi'])
    expect(groups[0].totalUnfilled).toBe(3)
  })

  it('keeps the order the classes arrive in, which is the order she taught them', () => {
    const groups = groupGapsByTeacher([
      gap({ classroomTeacherId: 'ct1', timeStart: '08:00:00' }),
      gap({ classroomTeacherId: 'ct2', timeStart: '10:00:00' }),
      gap({ classroomTeacherId: 'ct3', timeStart: '13:30:00' }),
    ])
    expect(groups[0].classes.map((c) => c.timeStart)).toEqual(['08:00:00', '10:00:00', '13:30:00'])
  })

  it('orders teachers by name', () => {
    const groups = groupGapsByTeacher([
      gap({ teacherId: 't2', teacherName: 'Bu Rina' }),
      gap({ classroomTeacherId: 'ct2', teacherId: 't1', teacherName: 'Bu Ayu' }),
    ])
    expect(groups.map((g) => g.teacherName)).toEqual(['Bu Ayu', 'Bu Rina'])
  })

  it('separates two teachers who share a call name', () => {
    // Grouped on teacherId, not the displayed name: merging them would address a reminder about
    // one teacher's class to the other's phone.
    const groups = groupGapsByTeacher([
      gap({ teacherId: 't1', teacherName: 'Bu Sri', teacherPhone: '081100000001' }),
      gap({
        classroomTeacherId: 'ct2',
        teacherId: 't2',
        teacherName: 'Bu Sri',
        teacherPhone: '081100000002',
      }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.teacherPhone)).toEqual(['081100000001', '081100000002'])
  })
})
