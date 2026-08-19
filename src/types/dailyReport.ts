import type { Database } from './database'
import type { MasteryLevel } from '../lib/masteryLevels'
import type { Mood } from '../lib/moods'
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
 * One student's daily report: "Materi Hari Ini" plus "Suasana Hati". `reportId` is null when
 * the teacher has not saved anything yet; `submittedAt` null means draft (not visible to
 * parents). The mood fields are null until filled in — unlike entries there is no "not
 * covered" state to represent, null just means not recorded yet.
 *
 * The remaining sections of the paper form (7 aspek perkembangan, pencapaian hari ini,
 * catatan tutor, keterlibatan) will be added as further sibling fields on this type.
 */
export type DailyReportMateri = {
  reportId: string | null
  childId: string
  classroomTeacherId: string
  reportDate: string
  submittedAt: string | null
  entries: DailyReportEntry[]
  moodArrival: Mood | null
  moodStudying: Mood | null
  moodDeparture: Mood | null
  /** The teacher's raw note — never shown to a parent. */
  moodNote: string | null
  /** Parent-facing rewrite of moodNote, from translate-mood-note + teacher review. Null until
   * generated. This is the only mood-note field DailyReportMateriPreview may read. */
  moodNoteParent: string | null
}

/** Per-student status shown in the class roster on the entry screen. */
export type DailyReportStatus = 'kosong' | 'draf' | 'terkirim'
