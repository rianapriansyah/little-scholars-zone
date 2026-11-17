import { supabase } from './supabase'
import type { Result } from './result'

/**
 * When and how one assignment (employee_assignments row) is worked, from the
 * employee_assignment_schedules view — the same source every clock-in rule in the database reads.
 * Teaching takes these from its class; staff work (Piket, Konten, Caregiving, Kasir...) from its
 * work item and its own times, with no classroom behind it.
 */
export type AssignmentSchedule = {
  classroomTeacherId: string
  employeeId: string
  /** null for staff work, which has no class. */
  classroomId: string | null
  /** null for teaching. */
  workItemId: string | null
  /** The class label, or "<work item> — <branch>" for staff work. */
  label: string
  /** 'HH:MM:SS' WITA wall-clock times, as the classrooms table stores them. */
  timeStart: string
  timeEnd: string
  /** No fixed hours to clock in/out against. Only staff work can be flexible; a class never is. */
  isFlexiHours: boolean
  /** Teaching a class (which parents pay for), as opposed to staff work. */
  isClass: boolean
  active: boolean
}

type ScheduleRow = {
  classroom_teacher_id: string | null
  employee_id: string | null
  classroom_id: string | null
  work_item_id: string | null
  label: string | null
  time_start: string | null
  time_end: string | null
  is_flexi_hours: boolean | null
  active: boolean | null
}

export function parseAssignmentSchedule(row: ScheduleRow): AssignmentSchedule | null {
  if (!row.classroom_teacher_id || !row.employee_id || !row.time_start || !row.time_end) return null
  return {
    classroomTeacherId: row.classroom_teacher_id,
    employeeId: row.employee_id,
    classroomId: row.classroom_id,
    workItemId: row.work_item_id,
    label: row.label ?? '—',
    timeStart: row.time_start,
    timeEnd: row.time_end,
    isFlexiHours: row.is_flexi_hours ?? false,
    isClass: row.classroom_id !== null,
    active: row.active ?? false,
  }
}

/**
 * Schedules of the assignments the caller may see (RLS): pass `employeeId` for one person's, or
 * `classroomTeacherIds` for specific ones, or neither for all (admin).
 */
export async function fetchAssignmentSchedules(
  filter: { employeeId?: string; classroomTeacherIds?: string[] } = {},
): Promise<Result<AssignmentSchedule[]>> {
  if (filter.classroomTeacherIds && filter.classroomTeacherIds.length === 0) return { ok: true, data: [] }

  let query = supabase.from('employee_assignment_schedules').select('*')
  if (filter.employeeId) query = query.eq('employee_id', filter.employeeId)
  if (filter.classroomTeacherIds) query = query.in('classroom_teacher_id', filter.classroomTeacherIds)
  const { data, error } = await query
  if (error) return { ok: false, error: error.message }

  const schedules: AssignmentSchedule[] = []
  for (const row of data ?? []) {
    const schedule = parseAssignmentSchedule(row)
    if (schedule) schedules.push(schedule)
  }
  return { ok: true, data: schedules }
}
