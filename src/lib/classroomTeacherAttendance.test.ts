import { describe, expect, it } from 'vitest'
import { buildContiguousChainLinks } from './classroomTeacherAttendance'

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
