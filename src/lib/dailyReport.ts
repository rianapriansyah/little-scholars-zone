import { supabase } from './supabase'
import type { Result } from './result'
import { isCurriculumSubject } from '../types/curriculumItem'
import type { CurriculumItemRow } from '../types/curriculumItem'
import { teacherDisplayName } from './teacherName'
import { isMood } from '../types/dailyReport'
import type { DailyReport, DailyReportEntry, DailyReportMoods } from '../types/dailyReport'
import { parseMasteryLevel, sortEntries, type RpcEntry } from './dailyReportEntries'

export type { Result } from './result'

export type RosterEntry = {
  childId: string
  childName: string
  photoUrl: string | null
}

export type ReportSummary = {
  reportId: string
  submittedAt: string | null
}

/** Shape of the nested rows Postgrest returns; kept local because the generated types model
 * embedded relations as `unknown` at this call site. */
type EmbeddedItemRow = {
  curriculum_item_id: string
  mastery_level: number
  curriculum_items: { subject: string; label: string; sort_order: number } | null
}

export async function fetchCurriculumItems(options?: { includeInactive?: boolean }): Promise<Result<CurriculumItemRow[]>> {
  let query = supabase.from('curriculum_items').select('*')
  if (!options?.includeInactive) query = query.eq('is_active', true)
  const { data, error } = await query.order('subject').order('sort_order').order('label')
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

/** The ≤6 children currently enrolled in one teaching group. */
export async function fetchClassRoster(classroomTeacherId: string): Promise<Result<RosterEntry[]>> {
  const { data, error } = await supabase
    .from('children_classrooms')
    .select('child_id, children(full_name, photo_url)')
    .eq('classroom_teacher_id', classroomTeacherId)
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

/** child_id → report id + submitted_at, for the draft/submitted badges on the roster. */
export async function fetchClassReportSummaries(
  classroomTeacherId: string,
  reportDate: string,
): Promise<Result<Map<string, ReportSummary>>> {
  const { data, error } = await supabase
    .from('children_daily_reports')
    .select('id, child_id, submitted_at')
    .eq('classroom_teacher_id', classroomTeacherId)
    .eq('report_date', reportDate)
  if (error) return { ok: false, error: error.message }

  const summaries = new Map<string, ReportSummary>()
  for (const row of data ?? []) {
    summaries.set(row.child_id, { reportId: row.id, submittedAt: row.submitted_at })
  }
  return { ok: true, data: summaries }
}

/** A stored mood value, or null for anything unset or unrecognised. */
function toMood(value: string | null) {
  return isMood(value) ? value : null
}

const NO_MOODS: DailyReportMoods = { arrival: null, studying: null, departure: null }

/**
 * One student's report for one class on one date — materi entries, moods and the teacher's note.
 * Returns an empty, unsaved DailyReport when no report exists yet, so callers never branch on
 * null.
 *
 * Filtered by classroom_teacher_id as well as child and date: a report is one per child per class
 * per day (children_daily_reports_child_class_date_key), so a child attending two programs on the
 * same day has two, and child + date alone would match both.
 */
export async function fetchDailyReport(
  childId: string,
  classroomTeacherId: string,
  reportDate: string,
): Promise<Result<DailyReport>> {
  // Kept as one string literal: Postgrest infers the embedded row types from the literal, and
  // a concatenated expression degrades the result to GenericStringError.
  const { data, error } = await supabase
    .from('children_daily_reports')
    .select(
      'id, child_id, classroom_teacher_id, report_date, submitted_at, mood_arrival, mood_studying, mood_departure, teacher_note, daily_report_items(curriculum_item_id, mastery_level, curriculum_items(subject, label, sort_order))',
    )
    .eq('child_id', childId)
    .eq('classroom_teacher_id', classroomTeacherId)
    .eq('report_date', reportDate)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }

  if (!data) {
    return {
      ok: true,
      data: {
        reportId: null,
        childId,
        classroomTeacherId,
        reportDate,
        submittedAt: null,
        entries: [],
        moods: NO_MOODS,
        teacherNote: '',
      },
    }
  }

  const itemRows = (data.daily_report_items ?? []) as unknown as EmbeddedItemRow[]
  const entries: DailyReportEntry[] = []
  for (const row of itemRows) {
    const masteryLevel = parseMasteryLevel(row.mastery_level)
    const catalog = row.curriculum_items
    if (masteryLevel === null || !catalog || !isCurriculumSubject(catalog.subject)) continue
    entries.push({
      curriculumItemId: row.curriculum_item_id,
      subject: catalog.subject,
      label: catalog.label,
      sortOrder: catalog.sort_order,
      masteryLevel,
    })
  }

  return {
    ok: true,
    data: {
      reportId: data.id,
      childId: data.child_id,
      classroomTeacherId: data.classroom_teacher_id,
      reportDate: data.report_date,
      submittedAt: data.submitted_at,
      entries: sortEntries(entries),
      moods: {
        arrival: toMood(data.mood_arrival),
        studying: toMood(data.mood_studying),
        departure: toMood(data.mood_departure),
      },
      teacherNote: data.teacher_note ?? '',
    },
  }
}

/**
 * Atomically upserts the report and replaces its materi entries with exactly `entries`.
 * Idempotent — safe to call repeatedly while the teacher corrects a draft. Returns the
 * report id.
 */
export async function saveDailyReportMateri(params: {
  childId: string
  classroomTeacherId: string
  reportDate: string
  entries: RpcEntry[]
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('save_daily_report_items', {
    p_child_id: params.childId,
    p_classroom_teacher_id: params.classroomTeacherId,
    p_report_date: params.reportDate,
    p_entries: params.entries,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/** What one attendance day's report held, for the read-only attendance detail dialog. */
export type DailyReportSummary = {
  reportId: string
  /** null means the teacher saved a draft but never sent it. */
  submittedAt: string | null
  moods: DailyReportMoods
  teacherNote: string | null
  /** Who wrote it, as they are addressed on screen. null if the teacher row has gone. */
  teacherName: string | null
}

/**
 * The report that belongs to one attendance row, or null when there is none to show.
 *
 * Goes through the daily_report_for_attendance RPC rather than querying the table: attendance is
 * keyed by program (child, classroom, date) and the report by teaching group (child,
 * classroom_teacher, date), so joining them needs classroom_teachers and teachers — neither of
 * which a parent can read in full. The RPC does that join server-side and applies the same access
 * rules the table's own policies do, so a parent still only ever sees their own child's submitted
 * reports. See 20261002010000_daily_report_for_attendance.sql.
 */
export async function fetchDailyReportForAttendance(
  childId: string,
  classroomId: string,
  reportDate: string,
): Promise<Result<DailyReportSummary | null>> {
  const { data, error } = await supabase.rpc('daily_report_for_attendance', {
    p_child_id: childId,
    p_classroom_id: classroomId,
    p_report_date: reportDate,
  })
  if (error) return { ok: false, error: error.message }

  // A table-returning function comes back as an array; the RPC caps it at one row. Empty means
  // either no report exists or the caller may not see it — both read as "nothing to show".
  const row = data?.[0]
  if (!row) return { ok: true, data: null }

  return {
    ok: true,
    data: {
      reportId: row.id,
      submittedAt: row.submitted_at,
      moods: {
        arrival: toMood(row.mood_arrival),
        studying: toMood(row.mood_studying),
        departure: toMood(row.mood_departure),
      },
      teacherNote: row.teacher_note,
      teacherName: row.teacher_full_name
        ? teacherDisplayName({ full_name: row.teacher_full_name, call_name: row.teacher_call_name })
        : null,
    },
  }
}

/**
 * Suasana Hati's Simpan. Upserts the three moods — and only those: the teacher note is not touched,
 * saved or unsaved. A null mood clears it. Returns the report id.
 */
export async function saveDailyReportMood(params: {
  childId: string
  classroomTeacherId: string
  reportDate: string
  moods: DailyReportMoods
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('save_daily_report_mood', {
    p_child_id: params.childId,
    p_classroom_teacher_id: params.classroomTeacherId,
    p_report_date: params.reportDate,
    // The generated Args type models these as optional strings rather than string | null;
    // undefined is omitted from the payload, so the RPC's DEFAULT NULL applies.
    p_mood_arrival: params.moods.arrival ?? undefined,
    p_mood_studying: params.moods.studying ?? undefined,
    p_mood_departure: params.moods.departure ?? undefined,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Catatan Guru's Simpan sebagai Draf (and the save half of Kirim). Upserts the teacher note —
 * and only that: the moods are not touched. A blank note is stored as NULL. Returns the report id.
 */
export async function saveDailyReportTeacherNote(params: {
  childId: string
  classroomTeacherId: string
  reportDate: string
  teacherNote: string
}): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('save_daily_report_teacher_note', {
    p_child_id: params.childId,
    p_classroom_teacher_id: params.classroomTeacherId,
    p_report_date: params.reportDate,
    p_teacher_note: params.teacherNote.trim() || undefined,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/** Stamps submitted_at, which is what makes the report visible to the parent. */
export async function submitDailyReport(reportId: string): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('submit_daily_report', { p_report_id: reportId })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}
