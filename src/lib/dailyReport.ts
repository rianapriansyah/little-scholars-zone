import { supabase } from './supabase'
import type { Result } from './result'
import { isCurriculumSubject } from '../types/curriculumItem'
import type { CurriculumItemRow } from '../types/curriculumItem'
import { teacherDisplayName } from './teacherName'
import { isMood } from '../types/dailyReport'
import type { DailyReport, DailyReportEntry, DailyReportMoods } from '../types/dailyReport'
import { parseMasteryLevel, sortEntries, type RpcEntry } from './dailyReportEntries'
import { DAILY_REPORT_MATERI_ENABLED } from './featureFlags'

export type { Result } from './result'

export type RosterEntry = {
  childId: string
  childName: string
  photoUrl: string | null
  /**
   * When this child joined this teaching group. Carried because the save RPCs refuse a report
   * dated before it, so the roster has to be able to say why a child cannot be opened rather
   * than letting the teacher fill a sheet that will be rejected on Simpan.
   */
  startedAt: string
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
    .select('child_id, started_at, children(full_name, photo_url)')
    .eq('classroom_teacher_id', classroomTeacherId)
    .is('ended_at', null)
  if (error) return { ok: false, error: error.message }

  const roster = (data ?? []).map((row) => {
    const child = row.children as unknown as { full_name: string; photo_url: string | null } | null
    return {
      childId: row.child_id,
      childName: child?.full_name ?? '—',
      photoUrl: child?.photo_url ?? null,
      startedAt: row.started_at,
    }
  })
  roster.sort((a, b) => a.childName.localeCompare(b.childName))
  return { ok: true, data: roster }
}

/**
 * child_id → report id + submitted_at, for the draft/submitted badges on the roster.
 *
 * Through the daily_report_summaries RPC: a report no longer stores its group or date
 * (20261108040000) — both are read through its absensi row, the group from the child's placement on
 * that date — so "this group's reports today" is a join the RPC does server-side.
 */
export async function fetchClassReportSummaries(
  classroomTeacherId: string,
  reportDate: string,
): Promise<Result<Map<string, ReportSummary>>> {
  const { data, error } = await supabase.rpc('daily_report_summaries', {
    p_classroom_teacher_id: classroomTeacherId,
    p_report_date: reportDate,
  })
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

/** The report columns both readers return. */
type ReportHeadRow = {
  id: string
  submitted_at: string | null
  mood_arrival: string | null
  mood_studying: string | null
  mood_departure: string | null
  teacher_note: string | null
}

/**
 * Turns a reader's row (or its absence) into a DailyReport, loading the materi entries. No row
 * gives an empty, unsaved report, so callers never branch on null.
 */
async function toDailyReport(
  head: ReportHeadRow | undefined,
  base: Pick<DailyReport, 'childId' | 'slot' | 'reportDate'>,
): Promise<Result<DailyReport>> {
  if (!head) {
    return {
      ok: true,
      data: { ...base, reportId: null, submittedAt: null, entries: [], moods: NO_MOODS, teacherNote: '' },
    }
  }

  // Materi entries only while that section is switched on — otherwise the screen never shows them,
  // and the table holds none.
  let itemRows: EmbeddedItemRow[] = []
  if (DAILY_REPORT_MATERI_ENABLED) {
    const items = await supabase
      .from('daily_report_items')
      .select('curriculum_item_id, mastery_level, curriculum_items(subject, label, sort_order)')
      .eq('report_id', head.id)
    if (items.error) return { ok: false, error: items.error.message }
    itemRows = (items.data ?? []) as unknown as EmbeddedItemRow[]
  }

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
      ...base,
      reportId: head.id,
      submittedAt: head.submitted_at,
      entries: sortEntries(entries),
      moods: {
        arrival: toMood(head.mood_arrival),
        studying: toMood(head.mood_studying),
        departure: toMood(head.mood_departure),
      },
      teacherNote: head.teacher_note ?? '',
    },
  }
}

/**
 * One student's report for one class on one date, as a teacher's roster opens it — materi entries,
 * moods and the teacher's note.
 *
 * The slot is (child, teaching group, date): a report is one per absensi row, so a child attending
 * two programs on the same day has two, and the group is what tells them apart. The report itself
 * stores neither group nor date (20261108040000), so the daily_report_for_slot RPC resolves the slot
 * to its absensi row server-side, with the same access rules the table's teacher policies apply.
 */
export async function fetchDailyReport(
  childId: string,
  classroomTeacherId: string,
  reportDate: string,
): Promise<Result<DailyReport>> {
  const { data: rows, error } = await supabase.rpc('daily_report_for_slot', {
    p_child_id: childId,
    p_classroom_teacher_id: classroomTeacherId,
    p_report_date: reportDate,
  })
  if (error) return { ok: false, error: error.message }

  // A table-returning function comes back as an array; one absensi row has at most one report.
  return toDailyReport(rows?.[0], { childId, slot: { kind: 'group', classroomTeacherId }, reportDate })
}

/**
 * The same report, as an admin's Tambah Absen opens it from a learning period's card: the period
 * names the child and class, the date picks the absensi row. No teaching group is resolved —
 * the report hangs off the absensi row alone (20261108050000), so the period is enough, and a date
 * the child's class placements happen not to cover does not block the admin.
 */
export async function fetchDailyReportForPeriod(
  period: { id: string; childId: string; classroomId: string },
  reportDate: string,
): Promise<Result<DailyReport>> {
  const { data: rows, error } = await supabase.rpc('daily_report_for_attendance', {
    p_child_id: period.childId,
    p_classroom_id: period.classroomId,
    p_report_date: reportDate,
  })
  if (error) return { ok: false, error: error.message }

  return toDailyReport(rows?.[0], {
    childId: period.childId,
    slot: { kind: 'period', learningPeriodId: period.id },
    reportDate,
  })
}

/** Which report a save writes to: the sheet's child and date, and the slot it was opened through. */
type SaveTarget = Pick<DailyReport, 'childId' | 'slot' | 'reportDate'>

/**
 * Atomically upserts the report and replaces its materi entries with exactly `entries`.
 * Idempotent — safe to call repeatedly while the teacher corrects a draft. Returns the
 * report id.
 */
export async function saveDailyReportMateri(target: SaveTarget, entries: RpcEntry[]): Promise<Result<string>> {
  const { data, error } =
    target.slot.kind === 'period'
      ? await supabase.rpc('save_daily_report_items_for_period', {
          p_learning_period_id: target.slot.learningPeriodId,
          p_report_date: target.reportDate,
          p_entries: entries,
        })
      : await supabase.rpc('save_daily_report_items', {
          p_child_id: target.childId,
          p_classroom_teacher_id: target.slot.classroomTeacherId,
          p_report_date: target.reportDate,
          p_entries: entries,
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
  /**
   * The report was filled from the admin side rather than by a teacher, so there is no name to
   * show — the screen labels it instead. Set when whoever sent (or opened) it carries the admin
   * role and has no teachers row.
   */
  authorIsAdmin: boolean
}

/**
 * The report that belongs to one attendance row, or null when there is none to show.
 *
 * Goes through the daily_report_for_attendance RPC rather than querying the table: naming who wrote
 * the report needs the teaching group and the employees table, neither of which a parent can read
 * in full. The RPC follows the report's child_attendance_id link server-side and applies the same
 * access rules the table's own policies do, so a parent still only ever sees their own child's
 * submitted reports. See 20261002010000, 20261108030000 and 20261108040000.
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
      authorIsAdmin: row.author_is_admin ?? false,
    },
  }
}

/**
 * Suasana Hati's Simpan. Upserts the three moods — and only those: the teacher note is not touched,
 * saved or unsaved. A null mood clears it. Returns the report id.
 */
export async function saveDailyReportMood(target: SaveTarget, moods: DailyReportMoods): Promise<Result<string>> {
  // The generated Args type models these as optional strings rather than string | null;
  // undefined is omitted from the payload, so the RPC's DEFAULT NULL applies.
  const moodArgs = {
    p_mood_arrival: moods.arrival ?? undefined,
    p_mood_studying: moods.studying ?? undefined,
    p_mood_departure: moods.departure ?? undefined,
  }
  const { data, error } =
    target.slot.kind === 'period'
      ? await supabase.rpc('save_daily_report_mood_for_period', {
          p_learning_period_id: target.slot.learningPeriodId,
          p_report_date: target.reportDate,
          ...moodArgs,
        })
      : await supabase.rpc('save_daily_report_mood', {
          p_child_id: target.childId,
          p_classroom_teacher_id: target.slot.classroomTeacherId,
          p_report_date: target.reportDate,
          ...moodArgs,
        })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}

/**
 * Catatan Guru's Simpan sebagai Draf (and the save half of Kirim). Upserts the teacher note —
 * and only that: the moods are not touched. A blank note is stored as NULL. Returns the report id.
 */
export async function saveDailyReportTeacherNote(target: SaveTarget, teacherNote: string): Promise<Result<string>> {
  const note = teacherNote.trim() || undefined
  const { data, error } =
    target.slot.kind === 'period'
      ? await supabase.rpc('save_daily_report_teacher_note_for_period', {
          p_learning_period_id: target.slot.learningPeriodId,
          p_report_date: target.reportDate,
          p_teacher_note: note,
        })
      : await supabase.rpc('save_daily_report_teacher_note', {
          p_child_id: target.childId,
          p_classroom_teacher_id: target.slot.classroomTeacherId,
          p_report_date: target.reportDate,
          p_teacher_note: note,
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

/**
 * Admin only (delete_daily_report checks the role). Removes a report, sent or not, so its absensi
 * day can be corrected: while a report exists the day is held at Hadir by
 * children_daily_reports_attendance_fkey (20261108030000).
 */
export async function deleteDailyReport(reportId: string): Promise<Result<void>> {
  const { error } = await supabase.rpc('delete_daily_report', { p_report_id: reportId })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: undefined }
}
