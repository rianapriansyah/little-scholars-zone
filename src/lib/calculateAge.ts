import dayjs, { type Dayjs } from 'dayjs'

/** Age from birthdate to today, e.g. "3 tahun 2 bulan" or "8 bulan" for under a year. */
export function formatAge(birthdate: Dayjs | null): string | null {
  if (!birthdate || !birthdate.isValid() || birthdate.isAfter(dayjs())) return null

  const now = dayjs()
  const years = now.diff(birthdate, 'year')
  const months = now.diff(birthdate.add(years, 'year'), 'month')

  if (years <= 0) return `${months} bulan`
  return months > 0 ? `${years} tahun ${months} bulan` : `${years} tahun`
}
