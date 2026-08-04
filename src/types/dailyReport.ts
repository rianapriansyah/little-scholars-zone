import type { Database } from './database'
import type { MasteryLevel } from '../lib/masteryLevels'
import type { CurriculumSubject } from './curriculumItem'

export type DailyReportRow = Database['public']['Tables']['daily_reports']['Row']
export type DailyReportItemRow = Database['public']['Tables']['daily_report_items']['Row']

/**
 * One materi covered for a student on one day, denormalised with its catalog label so the
 * preview can render without a second lookup. Only covered materi exist as entries — there
 * is no "level 0", absence means not covered.
 */
export type DailyReportEntry = {
  curriculumItemId: string
  subject: CurriculumSubject
  label: string
  sortOrder: number
  masteryLevel: MasteryLevel
}

/**
 * The "Materi Hari Ini" section of one student's daily report. `reportId` is null when the
 * teacher has not saved anything yet; `submittedAt` null means draft (not visible to parents).
 *
 * The other sections of the paper form will be added as sibling fields on this type.
 */
export type DailyReportMateri = {
  reportId: string | null
  childId: string
  classroomTeacherId: string
  reportDate: string
  submittedAt: string | null
  entries: DailyReportEntry[]
}

/** Per-student status shown in the class roster on the entry screen. */
export type DailyReportStatus = 'kosong' | 'draf' | 'terkirim'
