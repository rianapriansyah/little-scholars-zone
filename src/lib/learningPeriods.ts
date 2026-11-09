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
 * The classrooms a child is currently enrolled in, newest enrollment first. A child can sit in
 * one class per program, so this is a list — the period dialog preselects the head of it.
 * Enrollment points at a (classroom, teacher) pair, so the classroom comes out through
 * classroom_teachers.
 */
export async function fetchChildActiveClassrooms(childId: string): Promise<Result<ClassroomRow[]>> {
  const { data, error } = await supabase
    .from('children_classrooms')
    .select('classroom_teachers(classrooms(*))')
    .eq('child_id', childId)
    .is('ended_at', null)
    .order('started_at', { ascending: false })
  if (error) return { ok: false, error: error.message }

  const classrooms: ClassroomRow[] = []
  for (const row of data ?? []) {
    const group = row.classroom_teachers as unknown as { classrooms: ClassroomRow | null } | null
    if (group?.classrooms) classrooms.push(group.classrooms)
  }
  return { ok: true, data: classrooms }
}

/** Real, fee-paying classrooms only — is_billable excludes internal work programs (cleaning
 *  duty, content creation) a child must never be offered as something to enroll into. */
export async function fetchActiveClassrooms(): Promise<Result<ClassroomRow[]>> {
  const { data, error } = await supabase
    .from('classrooms')
    .select('*')
    .eq('active', true)
    .eq('is_billable', true)
    .order('label')
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
 * child_id → the period that covers `attendanceDate` in this classroom: it had started by
 * then, and had not already run out before then. A period that is still open has no end date
 * yet, so it covers every date from its start onwards.
 *
 * Attendance can only be recorded against such a period, so this doubles as the roster filter
 * on the daily report screen. An active period wins, then the lowest period_no, mirroring the
 * RPC's choice.
 */
export async function fetchPeriodsCoveringDate(
  classroomId: string,
  attendanceDate: string,
): Promise<Result<Map<string, LearningPeriodListEntry>>> {
  const { data, error } = await supabase
    .from('learning_period_status')
    .select('*, children(full_name), classrooms(label)')
    .eq('classroom_id', classroomId)
    .lte('start_date', attendanceDate)
    .or(`actual_end_date.is.null,actual_end_date.gte.${attendanceDate}`)
    // Active first, then lowest period_no — the same preference record_attendance applies.
    .order('is_active', { ascending: false })
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
    .from('children_learning_periods')
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
    .from('children_attendances')
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
 *
 * learningPeriodId is admin-only (Tambah Absen from a period's card): the day is filed on that
 * period rather than the lowest-numbered open one, and moved there if the date was filed
 * elsewhere. Teachers leave it out and get the automatic pick.
 */
export async function recordAttendance(params: {
  childId: string
  classroomId: string
  attendanceDate: string
  status: AttendanceStatus
  note?: string | null
  learningPeriodId?: string
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('record_attendance', {
    p_child_id: params.childId,
    p_classroom_id: params.classroomId,
    p_date: params.attendanceDate,
    p_status: params.status,
    p_note: params.note?.trim() || undefined,
    p_learning_period_id: params.learningPeriodId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Admin-only. Removes an attendance day that should never have been recorded and hands it back to
 * the period's quota — not the same thing as correcting one, which recordAttendance already does
 * by overwriting the status.
 *
 * Refused by the database when a daily report has been filed against the day; the report has to
 * go first, or the day would be gone with a report still pointing at it.
 */
export async function deleteChildAttendance(attendanceId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('delete_child_attendance', { p_attendance_id: attendanceId })
  if (error) {
    return {
      ok: false,
      error: error.message.includes('daily report')
        ? 'Tidak dapat dihapus: hari ini sudah memiliki laporan harian.'
        : error.message,
    }
  }
  return { ok: true, data: undefined }
}

/**
 * Admin-only, Hapus Absensi & Laporan: deletes a reported day and its daily report together, in
 * one transaction, and hands the day back to the quota like deleteChildAttendance. Either both go
 * or neither does.
 */
export async function deleteChildAttendanceWithReport(attendanceId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('delete_child_attendance_with_report', {
    p_attendance_id: attendanceId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}

/**
 * Admin-only, Pindahkan Absen. Re-points attendance days at another period of the same child and
 * class — for days that were filed against the wrong period before the right one existed.
 * Returns how many days actually moved.
 *
 * move_child_attendances recomputes both periods' closure in the same transaction and refuses to
 * push the target past its quota; its refusals are already worded for the admin.
 */
export async function moveChildAttendances(
  attendanceIds: string[],
  targetPeriodId: string,
): Promise<Result<number>> {
  const { data, error } = await supabase.rpc('move_child_attendances', {
    p_attendance_ids: attendanceIds,
    p_target_period_id: targetPeriodId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? 0 }
}

/**
 * Admin-only edit of a period that already exists — the three things that can legitimately have
 * been got wrong when it was sold: when it started, the rough end date shown to parents, and the
 * quota.
 *
 * guaranteed_days is editable on purpose. The trigger that copies it from the classroom is BEFORE
 * INSERT only, "so a bespoke deal can still be adjusted deliberately after the fact"
 * (20260805020000_classrooms_price_and_guaranteed_days.sql).
 *
 * Which means the quota cannot be written on its own: it is the line the period closes at, so
 * closed_at and actual_end_date have to be rewritten with it or the period keeps a closure that
 * its own numbers no longer justify. Same rule delete_child_attendance applies when it hands a
 * day back — above the line the period is open, exactly on it the period is full and closed on
 * the last day that consumed a slot. Shrinking it below the days already used is refused rather
 * than resolved, because that would leave days_remaining negative.
 *
 * period_no is editable too, and safely: children_attendances keys off (learning_period_id,
 * child_id, classroom_id), none of which is the number, and payment_periods references the
 * period's id. What it does change is precedence — record_attendance() files a genuinely new day
 * against the lowest open period_no — so renumbering decides which block the next day is billed
 * to. Its unique key is (child_id, classroom_id, period_no), so a number already taken in the
 * same class is refused; there is no swap, and freeing the number first is the way round it.
 *
 * The child and the classroom stay fixed: those two are in the attendance FK, and the payment row
 * was raised against them.
 */
export async function updateLearningPeriod(params: {
  periodId: string
  periodNo: number
  startDate: string
  projectedEndDate: string | null
  guaranteedDays: number
}): Promise<Result<void>> {
  const current = await fetchPeriod(params.periodId)
  if (!current.ok) return { ok: false, error: current.error }

  if (params.guaranteedDays < current.data.daysConsumed) {
    return {
      ok: false,
      error: `Kuota tidak boleh kurang dari hari yang sudah terpakai (${current.data.daysConsumed}).`,
    }
  }

  let closedAt: string | null = null
  let actualEndDate: string | null = null

  if (params.guaranteedDays === current.data.daysConsumed) {
    const attendances = await fetchPeriodAttendances(params.periodId)
    if (!attendances.ok) return { ok: false, error: attendances.error }
    // Exactly full, so the day that closes it is the last one to consume a slot. Sakit days are
    // skipped for the same reason they never counted toward the quota.
    const consumingDates = attendances.data
      .filter((row) => row.status !== 'sick')
      .map((row) => row.attendance_date)
      .sort()
    actualEndDate = consumingDates[consumingDates.length - 1] ?? null
    closedAt = new Date().toISOString()
  }

  const { error } = await supabase
    .from('children_learning_periods')
    .update({
      period_no: params.periodNo,
      start_date: params.startDate,
      projected_end_date: params.projectedEndDate,
      guaranteed_days: params.guaranteedDays,
      closed_at: closedAt,
      actual_end_date: actualEndDate,
    })
    .eq('id', params.periodId)

  if (error) {
    return {
      ok: false,
      error:
        error.code === '23505'
          ? `Nomor periode ${params.periodNo} sudah dipakai periode lain di kelas ini.`
          : error.message,
    }
  }
  return { ok: true, data: undefined }
}

/**
 * Admin-only, Tandai Selesai: closes a period by hand before its quota is used up — the child has
 * stopped coming, or moved on to the next block early.
 *
 * Only closed_at and actual_end_date are written. guaranteed_days is left alone, so Sisa still
 * shows the days the period was not used for rather than pretending they were consumed. The end
 * date is the last day recorded against the period, or today when nothing was recorded.
 *
 * `closed_at IS NULL` keeps a second click — or a period the quota closed in the meantime — from
 * overwriting the real closing date.
 */
export async function closeLearningPeriod(periodId: string): Promise<Result<void>> {
  const attendances = await fetchPeriodAttendances(periodId)
  if (!attendances.ok) return { ok: false, error: attendances.error }

  // fetchPeriodAttendances is newest first.
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const actualEndDate = attendances.data[0]?.attendance_date ?? todayIso

  const { error } = await supabase
    .from('children_learning_periods')
    .update({ closed_at: new Date().toISOString(), actual_end_date: actualEndDate })
    .eq('id', periodId)
    .is('closed_at', null)
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
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
    .from('children_attendances')
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

export type NewChildWithFirstPeriod = {
  fullName: string
  birthPlace: string | null
  /** ISO yyyy-mm-dd. */
  birthdate: string | null
  notes: string | null
  classroomId: string
  /** ISO yyyy-mm-dd. */
  startDate: string
  /** Already paid for — flips the auto-created payment row to paid in the same transaction. */
  paid: boolean
}

/**
 * Admin-only, Tambah Keluarga. Inserts the children, each with learning period #1, atomically —
 * all or none. Results line up index-for-index with `children`, carrying the payment_period id a
 * receipt can then be attached to.
 */
export async function createChildrenWithFirstPeriods(
  familyId: string,
  children: NewChildWithFirstPeriod[],
): Promise<Result<{ childId: string; paymentPeriodId: string }[]>> {
  const { data, error } = await supabase.rpc('create_children_with_first_periods', {
    p_family_id: familyId,
    p_children: children.map((child) => ({
      full_name: child.fullName,
      birth_place: child.birthPlace,
      birthdate: child.birthdate,
      notes: child.notes,
      classroom_id: child.classroomId,
      start_date: child.startDate,
      paid: child.paid,
    })),
  })
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as unknown as { child_id: string; payment_period_id: string }[]
  return { ok: true, data: rows.map((row) => ({ childId: row.child_id, paymentPeriodId: row.payment_period_id })) }
}

/**
 * Admin-only. period_no is derived as the child's highest so far in that classroom, plus one;
 * the unique constraint is the real guard if two admins race.
 *
 * guaranteed_days is deliberately not passed: a BEFORE INSERT trigger copies it from the
 * classroom, so the terms come from the program being sold rather than from the client.
 */
export async function createLearningPeriod(params: {
  childId: string
  classroomId: string
  startDate: string
  projectedEndDate?: string | null
}): Promise<Result<string>> {
  const { data: existing, error: qError } = await supabase
    .from('children_learning_periods')
    .select('period_no')
    .eq('child_id', params.childId)
    .eq('classroom_id', params.classroomId)
    .order('period_no', { ascending: false })
    .limit(1)
  if (qError) return { ok: false, error: qError.message }

  const nextPeriodNo = (existing?.[0]?.period_no ?? 0) + 1

  const { data, error } = await supabase
    .from('children_learning_periods')
    .insert({
      child_id: params.childId,
      classroom_id: params.classroomId,
      period_no: nextPeriodNo,
      start_date: params.startDate,
      projected_end_date: params.projectedEndDate || null,
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
