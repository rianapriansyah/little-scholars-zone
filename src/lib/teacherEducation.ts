export const EDUCATION_DELIMITER = ' | '

/** Splits the joined `teachers.education` column back into [level, school, year]. */
export function splitEducation(education: string | null): [string, string, string] {
  if (!education) return ['', '', '']
  const parts = education.split(EDUCATION_DELIMITER)
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? '']
}

/** Joins the three education form fields into the single `teachers.education` column. */
export function composeEducation(level: string, school: string, year: string): string | null {
  if (!level.trim() && !school.trim() && !year.trim()) return null
  return [level.trim(), school.trim(), year.trim()].join(EDUCATION_DELIMITER)
}
