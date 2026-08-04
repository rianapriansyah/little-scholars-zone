import { supabase } from './supabase'
import type { Result } from './result'
import { parseLearningPeriodStatus } from './attendanceQuota'
import type {
  AttendanceStatus,
  ChildAttendanceRow,
  LearningPeriodListEntry,
  LearningPeriodStatusRow,
} from '../types/attendance'
import type { ClassroomRow } from '../types/classroom'

export type RosterChild = {
  childId: string
  childName: string
  photoUrl: string | null
}

/** Embedded names Postgrest returns alongside a learning_period_status row. */
type PeriodWithNames = LearningPeriodStatusRow & {
  children: { full_name: string } | null
  classrooms: { label: string } | null
}

function toListEntry(row: PeriodWithNames): LearningPeriodListEntry | null {
  const status = parseLearningPeriodStatus(row)
  if (!status) return null
  return {
    ...status,
    childName: row.children?.full_name ?? '—',
    classroomLabel: row.classrooms?.label ?? '—',
  }
}

/** The classrooms this teacher is assigned to, via the classroom_teachers junction. */
export async function fetchTeacherClassrooms(teacherId: string): Promise<Result<ClassroomRow[]>> {
  const { data, error } = await supabase
    .from('classroom_teachers')
    .select('classrooms(*)')
    .eq('teacher_id', teacherId)
  if (error) return { ok: false, error: error.message }

  // A teacher can hold more than one group in the same classroom, so de-duplicate.
  const byId = new Map<string, ClassroomRow>()
  for (const row of data ?? []) {
    const classroom = row.classrooms as unknown as ClassroomRow | null
    if (classroom) byId.set(classroom.id, classroom)
  }
  const classrooms = [...byId.values()].sort((a, b) => a.label.localeCompare(b.label))
  return { ok: true, data: classrooms }
}

/**
 * The classroom a child is currently enrolled in, or null. Used to preselect the classroom
 * when an admin opens a new period — enrollment points at a (classroom, teacher) pair, so the
 * classroom comes out through classroom_teachers.
 */
export async function fetchChildActiveClassroom(childId: string): Promise<Result<ClassroomRow | null>> {
  const { data, error } = await supabase
    .from('children_classrooms')
    .select('classroom_teachers(classrooms(*))')
    .eq('child_id', childId)
    .is('ended_at', null)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }

  const group = data?.classroom_teachers as unknown as { classrooms: ClassroomRow | null } | null
  return { ok: true, data: group?.classrooms ?? null }
}

export async function fetchActiveClassrooms(): Promise<Result<ClassroomRow[]>> {
  const { data, error } = await supabase.from('classrooms').select('*').eq('active', true).order('label')
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

/**
 * Children currently enrolled in a classroom. Enrollment points at a (classroom, teacher)
 * pair, so the classroom's groups have to be resolved first — the same two-step the admin
 * assignment screen uses.
 */
export async function fetchClassroomRoster(classroomId: string): Promise<Result<RosterChild[]>> {
  const { data: groupRows, error: gError } = await supabase
    .from('classroom_teachers')
    .select('id')
    .eq('classroom_id', classroomId)
  if (gError) return { ok: false, error: gError.message }

  const groupIds = (groupRows ?? []).map((row) => row.id)
  if (groupIds.length === 0) return { ok: true, data: [] }

  const { data, error } = await supabase
    .from('children_classrooms')
    .select('child_id, children(full_name, photo_url)')
    .in('classroom_teacher_id', groupIds)
    .is('ended_at', null)
  if (error) return { ok: false, error: error.message }

  const roster = (data ?? []).map((row) => {
    const child = row.children as unknown as { full_name: string; photo_url: string | null } | null
    return {
      childId: row.child_id,
      childName: child?.full_name ?? '—',
      photoUrl: child?.photo_url ?? null,
    }
  })
  roster.sort((a, b) => a.childName.localeCompare(b.childName))
  return { ok: true, data: roster }
}

/**
 * child_id → the open period the next attendance row will draw from. Mirrors the RPC's
 * choice: closed_at is null, lowest period_no wins.
 */
export async function fetchOpenPeriodsByChild(
  classroomId: string,
): Promise<Result<Map<string, LearningPeriodListEntry>>> {
  const { data, error } = await supabase
    .from('learning_period_status')
    .select('*, children(full_name), classrooms(label)')
    .eq('classroom_id', classroomId)
    .is('closed_at', null)
    .order('period_no', { ascending: true })
  if (error) return { ok: false, error: error.message }

  const byChild = new Map<string, LearningPeriodListEntry>()
  for (const row of (data ?? []) as unknown as PeriodWithNames[]) {
    const entry = toListEntry(row)
    if (!entry) continue
    if (!byChild.has(entry.childId)) byChild.set(entry.childId, entry)
  }
  return { ok: true, data: byChild }
}

/**
 * Children who hold an open learning period in this classroom — i.e. who have been sold the
 * program and can legitimately be enrolled into one of its groups. Enrolling anyone else is a
 * dead end: record_attendance() refuses to file a day without an open period.
 */
export async function fetchChildIdsWithOpenPeriod(classroomId: string): Promise<Result<Set<string>>> {
  const { data, error } = await supabase
    .from('learning_periods')
    .select('child_id')
    .eq('classroom_id', classroomId)
    .is('closed_at', null)
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: new Set((data ?? []).map((row) => row.child_id)) }
}

/** child_id → the attendance already recorded for this classroom on this date, if any. */
export async function fetchAttendanceByChild(
  classroomId: string,
  attendanceDate: string,
): Promise<Result<Map<string, ChildAttendanceRow>>> {
  const { data, error } = await supabase
    .from('child_attendances')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('attendance_date', attendanceDate)
  if (error) return { ok: false, error: error.message }

  const byChild = new Map<string, ChildAttendanceRow>()
  for (const row of data ?? []) byChild.set(row.child_id, row)
  return { ok: true, data: byChild }
}

/**
 * Records or corrects one child's attendance. Idempotent — re-submitting the same date
 * updates the row rather than consuming a second day. Returns the attendance row id.
 */
export async function recordAttendance(params: {
  childId: string
  classroomId: string
  attendanceDate: string
  status: AttendanceStatus
  note?: string | null
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('record_attendance', {
    p_child_id: params.childId,
    p_classroom_id: params.classroomId,
    p_date: params.attendanceDate,
    p_status: params.status,
    p_note: params.note?.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

export async function fetchPeriod(periodId: string): Promise<Result<LearningPeriodListEntry>> {
  const { data, error } = await supabase
    .from('learning_period_status')
    .select('*, children(full_name), classrooms(label)')
    .eq('id', periodId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'Periode belajar tidak ditemukan.' }

  const entry = toListEntry(data as unknown as PeriodWithNames)
  if (!entry) return { ok: false, error: 'Data periode belajar tidak lengkap.' }
  return { ok: true, data: entry }
}

export async function fetchPeriodAttendances(periodId: string): Promise<Result<ChildAttendanceRow[]>> {
  const { data, error } = await supabase
    .from('child_attendances')
    .select('*')
    .eq('learning_period_id', periodId)
    .order('attendance_date', { ascending: false })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

/** Admin renewal queue: every open period, nearest to running out first. */
export async function fetchOpenPeriods(): Promise<Result<LearningPeriodListEntry[]>> {
  const { data, error } = await supabase
    .from('learning_period_status')
    .select('*, children(full_name), classrooms(label)')
    .is('closed_at', null)
    .order('days_remaining', { ascending: true })
  if (error) return { ok: false, error: error.message }

  const entries: LearningPeriodListEntry[] = []
  for (const row of (data ?? []) as unknown as PeriodWithNames[]) {
    const entry = toListEntry(row)
    if (entry) entries.push(entry)
  }
  return { ok: true, data: entries }
}

/** Every period a child has ever held, newest first — the family tab's table. */
export async function fetchPeriodsForChild(childId: string): Promise<Result<LearningPeriodListEntry[]>> {
  const { data, error } = await supabase
    .from('learning_period_status')
    .select('*, children(full_name), classrooms(label)')
    .eq('child_id', childId)
    .order('period_no', { ascending: false })
  if (error) return { ok: false, error: error.message }

  const entries: LearningPeriodListEntry[] = []
  for (const row of (data ?? []) as unknown as PeriodWithNames[]) {
    const entry = toListEntry(row)
    if (entry) entries.push(entry)
  }
  return { ok: true, data: entries }
}

/**
 * Admin-only. period_no is derived as the child's highest so far in that classroom, plus one;
 * the unique constraint is the real guard if two admins race.
 */
export async function createLearningPeriod(params: {
  childId: string
  classroomId: string
  startDate: string
  projectedEndDate?: string | null
  guaranteedDays?: number
}): Promise<Result<string>> {
  const { data: existing, error: qError } = await supabase
    .from('learning_periods')
    .select('period_no')
    .eq('child_id', params.childId)
    .eq('classroom_id', params.classroomId)
    .order('period_no', { ascending: false })
    .limit(1)
  if (qError) return { ok: false, error: qError.message }

  const nextPeriodNo = (existing?.[0]?.period_no ?? 0) + 1

  const { data, error } = await supabase
    .from('learning_periods')
    .insert({
      child_id: params.childId,
      classroom_id: params.classroomId,
      period_no: nextPeriodNo,
      start_date: params.startDate,
      projected_end_date: params.projectedEndDate || null,
      ...(params.guaranteedDays ? { guaranteed_days: params.guaranteedDays } : {}),
    })
    .select('id')
    .single()
  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? 'Periode dengan nomor yang sama sudah ada untuk anak ini di kelas tersebut. Muat ulang halaman lalu coba lagi.'
          : error.message,
    }
  }
  return { ok: true, data: data.id }
}
