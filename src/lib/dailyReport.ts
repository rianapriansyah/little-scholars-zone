import { supabase } from './supabase'
import { isCurriculumSubject } from '../types/curriculumItem'
import type { CurriculumItemRow } from '../types/curriculumItem'
import type { DailyReportEntry, DailyReportMateri } from '../types/dailyReport'
import { parseMasteryLevel, sortEntries, type RpcEntry } from './dailyReportEntries'

/**
 * Uniform result shape so callers can surface `error` the same way the rest of the app does.
 * Discriminated on `ok` rather than on `error` being null, so `if (!result.ok)` narrows
 * `result.data` to non-null for TypeScript.
 */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

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
    .from('daily_reports')
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

/**
 * The Materi Hari Ini section for one student on one date. Returns an empty, unsaved
 * DailyReportMateri when no report exists yet, so callers never branch on null.
 */
export async function fetchDailyReportMateri(
  childId: string,
  classroomTeacherId: string,
  reportDate: string,
): Promise<Result<DailyReportMateri>> {
  // Kept as one string literal: Postgrest infers the embedded row types from the literal, and
  // a concatenated expression degrades the result to GenericStringError.
  const { data, error } = await supabase
    .from('daily_reports')
    .select(
      'id, child_id, classroom_teacher_id, report_date, submitted_at, daily_report_items(curriculum_item_id, mastery_level, curriculum_items(subject, label, sort_order))',
    )
    .eq('child_id', childId)
    .eq('report_date', reportDate)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }

  if (!data) {
    return {
      ok: true,
      data: { reportId: null, childId, classroomTeacherId, reportDate, submittedAt: null, entries: [] },
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

/** Stamps submitted_at, which is what makes the report visible to the parent. */
export async function submitDailyReport(reportId: string): Promise<Result<string>> {
  const { data, error } = await supabase.rpc('submit_daily_report', { p_report_id: reportId })
  if (error) return { ok: false, error: error.message }
  return { ok: true, data }
}
