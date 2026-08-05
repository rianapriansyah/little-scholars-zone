import { supabase } from './supabase'
import type { Result } from './result'
import { teacherDisplayName } from './teacherName'
import {
  ATTENDANCE_SOURCES,
  type AttendanceSource,
  type ArrivalStatus,
  type ClassroomTeacherAttendanceListEntry,
  type ClassroomTeacherAttendanceStatus,
  type ClassroomTeacherAttendanceStatusRow,
  type DepartureStatus,
} from '../types/classroomTeacherAttendance'

function toAttendanceSource(value: string | null): AttendanceSource | null {
  return value !== null && (ATTENDANCE_SOURCES as readonly string[]).includes(value) ? (value as AttendanceSource) : null
}

/**
 * Narrows a raw view row. Returns null rather than throwing when a required column is
 * missing, so one malformed row cannot blank an entire list — same reasoning as
 * parseLearningPeriodStatus.
 */
export function parseClassroomTeacherAttendanceStatus(
  row: ClassroomTeacherAttendanceStatusRow,
): ClassroomTeacherAttendanceStatus | null {
  const { id, classroom_teacher_id, session_date, scheduled_start, scheduled_end, arrival_status, departure_status } =
    row
  if (
    id === null ||
    classroom_teacher_id === null ||
    session_date === null ||
    scheduled_start === null ||
    scheduled_end === null ||
    arrival_status === null ||
    departure_status === null
  ) {
    return null
  }

  return {
    id,
    classroomTeacherId: classroom_teacher_id,
    sessionDate: session_date,
    clockedInAt: row.clocked_in_at,
    clockedInSource: toAttendanceSource(row.clocked_in_source),
    clockedOutAt: row.clocked_out_at,
    clockedOutSource: toAttendanceSource(row.clocked_out_source),
    editedBy: row.edited_by,
    notes: row.notes,
    scheduledStart: scheduled_start,
    scheduledEnd: scheduled_end,
    minutesTaught: row.minutes_taught,
    arrivalStatus: arrival_status as ArrivalStatus,
    departureStatus: departure_status as DepartureStatus,
  }
}

/**
 * classroom_teacher_id → today's attendance status, for the teacher's own class cards. Only
 * classes that already have a row come back — no row means neither button has been tapped yet.
 */
export async function fetchAttendanceForClassroomTeachers(
  classroomTeacherIds: string[],
  sessionDate: string,
): Promise<Result<Map<string, ClassroomTeacherAttendanceStatus>>> {
  if (classroomTeacherIds.length === 0) return { ok: true, data: new Map() }

  const { data, error } = await supabase
    .from('classroom_teachers_attendance_status')
    .select('*')
    .in('classroom_teacher_id', classroomTeacherIds)
    .eq('session_date', sessionDate)
  if (error) return { ok: false, error: error.message }

  const byClassroomTeacher = new Map<string, ClassroomTeacherAttendanceStatus>()
  for (const row of data ?? []) {
    const status = parseClassroomTeacherAttendanceStatus(row)
    if (status) byClassroomTeacher.set(status.classroomTeacherId, status)
  }
  return { ok: true, data: byClassroomTeacher }
}

/** Masuk Kelas. The server re-checks the 5-minute window; a rejection surfaces as the error string. */
export async function clockInClassroomTeacher(classroomTeacherId: string): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('clock_in_classroom_teacher', {
    p_classroom_teacher_id: classroomTeacherId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/** Selesaikan Kelas. The server re-checks that the end-minus-5-minute floor has been reached. */
export async function clockOutClassroomTeacher(classroomTeacherId: string): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('clock_out_classroom_teacher', {
    p_classroom_teacher_id: classroomTeacherId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Every active classroom_teacher, joined with that date's attendance status if one exists —
 * the admin Kehadiran Guru roster. Classes with no row at all still appear, with `status: null`,
 * so a forgotten punch is visible as a gap rather than silently absent from the list.
 */
export async function fetchAttendanceRoster(sessionDate: string): Promise<Result<ClassroomTeacherAttendanceListEntry[]>> {
  const { data: groupRows, error: gError } = await supabase
    .from('classroom_teachers')
    .select('id, classrooms(label, time_start, time_end, active), teachers(full_name, call_name)')
  if (gError) return { ok: false, error: gError.message }

  const { data: statusRows, error: sError } = await supabase
    .from('classroom_teachers_attendance_status')
    .select('*')
    .eq('session_date', sessionDate)
  if (sError) return { ok: false, error: sError.message }

  const byClassroomTeacher = new Map<string, ClassroomTeacherAttendanceStatus>()
  for (const row of statusRows ?? []) {
    const status = parseClassroomTeacherAttendanceStatus(row)
    if (status) byClassroomTeacher.set(status.classroomTeacherId, status)
  }

  const entries: ClassroomTeacherAttendanceListEntry[] = []
  for (const group of groupRows ?? []) {
    const classroom = group.classrooms as unknown as
      | { label: string; time_start: string; time_end: string; active: boolean }
      | null
    const teacher = group.teachers as unknown as { full_name: string; call_name: string | null } | null
    if (!classroom || !classroom.active) continue

    entries.push({
      classroomTeacherId: group.id,
      classroomLabel: classroom.label,
      teacherName: teacher ? teacherDisplayName(teacher) : '—',
      timeStart: classroom.time_start,
      timeEnd: classroom.time_end,
      status: byClassroomTeacher.get(group.id) ?? null,
    })
  }
  entries.sort((a, b) => a.classroomLabel.localeCompare(b.classroomLabel))
  return { ok: true, data: entries }
}

/**
 * Admin fill-in/correction. A plain upsert rather than the teacher RPCs — admin already has
 * unrestricted RLS access, and correcting a punch is exactly the case the 5-minute window is
 * not meant to guard against. Always tags both timestamps' source as 'admin' on save: this is
 * the admin explicitly attesting to the values shown in the dialog, not a partial patch.
 */
export async function saveClassroomTeacherAttendance(params: {
  classroomTeacherId: string
  sessionDate: string
  clockedInAt: string | null
  clockedOutAt: string | null
  notes?: string | null
}): Promise<Result<string>> {
  const { data: userRes } = await supabase.auth.getUser()

  const { data, error } = await supabase
    .from('classroom_teachers_attendances')
    .upsert(
      {
        classroom_teacher_id: params.classroomTeacherId,
        session_date: params.sessionDate,
        clocked_in_at: params.clockedInAt,
        clocked_in_source: params.clockedInAt ? 'admin' : null,
        clocked_out_at: params.clockedOutAt,
        clocked_out_source: params.clockedOutAt ? 'admin' : null,
        edited_by: userRes.user?.id ?? null,
        notes: params.notes?.trim() || null,
      },
      { onConflict: 'classroom_teacher_id,session_date' },
    )
    .select('id')
    .single()
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data.id }
}
