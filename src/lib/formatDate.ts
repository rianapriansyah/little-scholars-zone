import dayjs from 'dayjs'

/** The one date format the app shows anywhere: 14-September-2026. Storage stays ISO. */
export const DISPLAY_DATE_FORMAT = 'DD-MMMM-YYYY'

/** Indexed by calendar month number minus one (January = 0), matching Dayjs's `month()`. */
export const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
]

/**
 * Renders a date for display as DD-MMMM-YYYY with Indonesian month names.
 *
 * Takes what the database and the pickers actually hand us — an ISO `yyyy-mm-dd` string, a
 * timestamp, a Date or a Dayjs — and returns `fallback` for anything empty or unparseable, so
 * callers never have to guard first.
 */
export function formatDate(value: string | number | Date | dayjs.Dayjs | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback
  const d = dayjs(value)
  if (!d.isValid()) return fallback
  return `${d.format('DD')}-${MONTH_NAMES_ID[d.month()]}-${d.format('YYYY')}`
}

/** formatDate plus the wall-clock time, for timestamps where the hour carries meaning. */
export function formatDateTime(
  value: string | number | Date | dayjs.Dayjs | null | undefined,
  fallback = '—',
): string {
  if (value === null || value === undefined || value === '') return fallback
  const d = dayjs(value)
  if (!d.isValid()) return fallback
  return `${formatDate(d)} ${d.format('HH:mm')}`
}
