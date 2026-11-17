import { describe, expect, it } from 'vitest'
import { parseAssignmentSchedule } from './assignmentSchedules'

const base = {
  classroom_teacher_id: 'ct1',
  employee_id: 'e1',
  classroom_id: null,
  work_item_id: 'w1',
  label: 'Kasir — Rumah Main Rumah Kecil (Rucil)',
  time_start: '11:00:00',
  time_end: '12:00:00',
  is_flexi_hours: false,
  active: true,
}

describe('parseAssignmentSchedule', () => {
  it('reads a staff-work assignment, which has no classroom', () => {
    expect(parseAssignmentSchedule(base)).toEqual({
      classroomTeacherId: 'ct1',
      employeeId: 'e1',
      classroomId: null,
      workItemId: 'w1',
      label: 'Kasir — Rumah Main Rumah Kecil (Rucil)',
      timeStart: '11:00:00',
      timeEnd: '12:00:00',
      isFlexiHours: false,
      isClass: false,
      active: true,
    })
  })

  it('reads a teaching assignment', () => {
    const parsed = parseAssignmentSchedule({
      ...base,
      classroom_id: 'c1',
      work_item_id: null,
      label: 'Kelas Bimba Pukul 08.00 - 10.00',
    })
    expect(parsed?.classroomId).toBe('c1')
    expect(parsed?.isClass).toBe(true)
  })

  it('drops a row it cannot schedule rather than inventing times', () => {
    expect(parseAssignmentSchedule({ ...base, time_start: null })).toBeNull()
    expect(parseAssignmentSchedule({ ...base, classroom_teacher_id: null })).toBeNull()
  })

  it('treats a missing flexi or active flag as false', () => {
    const parsed = parseAssignmentSchedule({ ...base, is_flexi_hours: null, active: null })
    expect(parsed?.isFlexiHours).toBe(false)
    expect(parsed?.active).toBe(false)
  })
})
