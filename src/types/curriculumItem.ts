import type { Database } from './database'

export type CurriculumItemRow = Database['public']['Tables']['curriculum_items']['Row']

/** Mirrors the curriculum_items.subject CHECK constraint. */
export const CURRICULUM_SUBJECTS = ['literasi', 'numerasi'] as const

export type CurriculumSubject = (typeof CURRICULUM_SUBJECTS)[number]

export const CURRICULUM_SUBJECT_LABELS: Record<CurriculumSubject, string> = {
  literasi: 'Literasi',
  numerasi: 'Numerasi',
}

export function isCurriculumSubject(value: string): value is CurriculumSubject {
  return (CURRICULUM_SUBJECTS as readonly string[]).includes(value)
}
