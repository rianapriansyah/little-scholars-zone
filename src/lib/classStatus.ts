export type ClassStatusBorder = 'green' | 'red' | 'yellow' | 'default'

export type ClassStatus = {
  border: ClassStatusBorder
  label: string | null
}

/**
 * Priority order, most urgent first: finished > already started > within 10min > within 30min
 * > default. Pure function over instants — no timezone handling here (see
 * getTodaysClassStartInWita / getTodaysClassEndInWita for turning a classroom's wall-clock
 * times into the correct instants).
 *
 * `endTime` stays optional so this remains a pure function of the instants it is given, but
 * classrooms.time_end is now NOT NULL, so every real caller has one. Passing null means there
 * is nothing to compare against and the class never stops looking in progress.
 */
export function getClassStatus(startTime: Date, now: Date, endTime: Date | null = null): ClassStatus {
  if (endTime !== null && now.getTime() >= endTime.getTime()) {
    return { border: 'default', label: 'Kelas selesai' }
  }

  const minutesUntilStart = (startTime.getTime() - now.getTime()) / 60_000

  if (minutesUntilStart <= 0) {
    return { border: 'green', label: 'Kelas sedang berjalan' }
  }
  if (minutesUntilStart <= 10) {
    return { border: 'red', label: null }
  }
  if (minutesUntilStart <= 30) {
    return { border: 'yellow', label: null }
  }
  return { border: 'default', label: null }
}

const WITA_TIME_ZONE = 'Asia/Makassar'
const WITA_UTC_OFFSET_HOURS = 8 // fixed offset, no DST

function getWitaDateParts(instant: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WITA_TIME_ZONE,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return {
    weekday: map.weekday,
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  }
}

/**
 * Today's date in Asia/Makassar as YYYY-MM-DD. A daily report is filed against a WITA
 * calendar day, so deriving it from the browser's local date (or a UTC toISOString()) would
 * file the report under the wrong day for anyone whose clock is behind UTC+8.
 */
export function todayIsoDateInWita(referenceNow: Date = new Date()): string {
  const { year, month, day } = getWitaDateParts(referenceNow)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const WEEKDAYS = new Set(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'])

/**
 * Returns the instant `time` (HH:MM[:SS]) falls on *today's WITA date*, or null if today is a
 * weekend in WITA (classrooms only run Monday–Friday). Always uses Asia/Makassar (UTC+8, no
 * DST) regardless of the browser/server's local timezone.
 */
function getTodaysWitaInstant(time: string, referenceNow: Date): Date | null {
  const { weekday, year, month, day } = getWitaDateParts(referenceNow)
  if (!WEEKDAYS.has(weekday)) return null

  const [hourStr, minuteStr] = time.split(':')
  const hour = Number(hourStr)
  const minute = Number(minuteStr)

  return new Date(Date.UTC(year, month - 1, day, hour - WITA_UTC_OFFSET_HOURS, minute))
}

export function getTodaysClassStartInWita(timeStart: string, referenceNow: Date = new Date()): Date | null {
  return getTodaysWitaInstant(timeStart, referenceNow)
}

/**
 * Null on a WITA weekend. Still accepts null for `timeEnd` — classrooms.time_end is NOT NULL
 * in the database, but keeping the guard means stale or hand-built data cannot crash the
 * teacher's home screen.
 */
export function getTodaysClassEndInWita(timeEnd: string | null, referenceNow: Date = new Date()): Date | null {
  return timeEnd ? getTodaysWitaInstant(timeEnd, referenceNow) : null
}
