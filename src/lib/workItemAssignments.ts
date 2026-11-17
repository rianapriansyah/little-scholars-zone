import { supabase } from './supabase'
import type { Result } from './result'
import { teacherDisplayName } from './teacherName'

/** One person assigned to a work item, with the times they work it. */
export type WorkItemAssignment = {
  /** employee_assignments.id — what they clock in against. */
  id: string
  employeeId: string
  employeeName: string
  /** 'HH:MM:SS' WITA. */
  timeStart: string
  timeEnd: string
  isFlexiHours: boolean
  /** Clock-in days recorded on it. An assignment with history is never deleted. */
  clockInCount: number
}

export type WorkItemAssignmentInput = {
  employeeId: string
  /** 'HH:MM' WITA. */
  timeStart: string
  timeEnd: string
  isFlexiHours: boolean
}

/** Everyone assigned to the work item, by start time then name. Admin only. */
export async function fetchWorkItemAssignments(workItemId: string): Promise<Result<WorkItemAssignment[]>> {
  const { data, error } = await supabase
    .from('employee_assignments')
    .select('id, teacher_id, time_start, time_end, is_flexi_hours, employees(full_name, call_name), employee_attendances(count)')
    .eq('work_item_id', workItemId)
  if (error) return { ok: false, error: error.message }

  const assignments = (data ?? []).map((row) => {
    const employee = row.employees as unknown as { full_name: string; call_name: string | null } | null
    const attendances = row.employee_attendances as unknown as { count: number }[] | null
    return {
      id: row.id,
      employeeId: row.teacher_id,
      employeeName: employee ? teacherDisplayName(employee) : '—',
      timeStart: row.time_start ?? '',
      timeEnd: row.time_end ?? '',
      isFlexiHours: row.is_flexi_hours ?? false,
      clockInCount: attendances?.[0]?.count ?? 0,
    }
  })
  assignments.sort((a, b) => a.timeStart.localeCompare(b.timeStart) || a.employeeName.localeCompare(b.employeeName))
  return { ok: true, data: assignments }
}

export async function createWorkItemAssignment(
  workItemId: string,
  input: WorkItemAssignmentInput,
): Promise<Result<void>> {
  if (input.timeEnd <= input.timeStart) return { ok: false, error: 'Jam selesai harus setelah jam mulai.' }
  const { error } = await supabase.from('employee_assignments').insert({
    teacher_id: input.employeeId,
    work_item_id: workItemId,
    classroom_id: null,
    time_start: input.timeStart,
    time_end: input.timeEnd,
    is_flexi_hours: input.isFlexiHours,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

/**
 * Removes an assignment that was never worked. One with clock-ins is refused: its hours and pay
 * history must stay. (Such a person simply stops clocking in on it.)
 */
export async function deleteWorkItemAssignment(assignment: WorkItemAssignment): Promise<Result<void>> {
  if (assignment.clockInCount > 0) {
    return {
      ok: false,
      error: `Penugasan ${assignment.employeeName} sudah punya ${assignment.clockInCount} hari absen, jadi tidak dihapus agar riwayat jam dan gajinya tetap ada.`,
    }
  }
  const { error } = await supabase.from('employee_assignments').delete().eq('id', assignment.id)
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
