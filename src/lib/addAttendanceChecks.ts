import { formatDate } from './formatDate'
import type { ChildAttendanceRow, LearningPeriodStatus } from '../types/attendance'

/**
 * The rules Tambah Absen (admin, from one learning period's card) applies before it opens the
 * sheet. Kept apart from the dialog so they can be tested on their own.
 */

type PeriodSpan = Pick<LearningPeriodStatus, 'id' | 'periodNo' | 'startDate' | 'actualEndDate'>

/**
 * The period's quota is used up: Hadir and Alfa have drawn down every guaranteed day. Tambah Absen
 * is switched off rather than letting the admin pick a date only to be refused on save.
 */
export function isPeriodQuotaFull(period: Pick<LearningPeriodStatus, 'daysConsumed' | 'guaranteedDays'>): boolean {
  return period.daysConsumed >= period.guaranteedDays
}

/** The child's next period in the same class: the lowest period number above this one. */
export function nextPeriodOf<T extends PeriodSpan>(period: PeriodSpan, classPeriods: readonly T[]): T | null {
  let next: T | null = null
  for (const other of classPeriods) {
    if (other.id === period.id || other.periodNo <= period.periodNo) continue
    if (!next || other.periodNo < next.periodNo) next = other
  }
  return next
}

/**
 * Why `date` cannot be added to `period`, or null when it can.
 *
 * - Already recorded on another of the child's periods in this class → refused; the admin moves it
 *   with Pindahkan Absen instead. A day already on this period is fine (it is being corrected).
 * - Before the period started → refused.
 * - After the period ended → refused. The end is the period's actual end date when it has one,
 *   otherwise the day before the next period starts; an open last period has no end (the picker
 *   already stops at today).
 *
 * Dates are ISO yyyy-mm-dd, so plain string comparison orders them.
 */
export function addAttendanceDateProblem(params: {
  date: string
  period: PeriodSpan
  /** The child's periods in the same class (this one may be included). */
  classPeriods: readonly PeriodSpan[]
  /** The day's existing absensi row for this child and class, if any. */
  existing: Pick<ChildAttendanceRow, 'learning_period_id'> | null
}): string | null {
  const { date, period, classPeriods, existing } = params

  if (existing && existing.learning_period_id !== period.id) {
    const owner = classPeriods.find((p) => p.id === existing.learning_period_id)
    return owner
      ? `Tanggal ini sudah tercatat di Periode ${owner.periodNo}. Gunakan Pindahkan Absen bila perlu dipindah.`
      : 'Tanggal ini sudah tercatat di periode lain. Gunakan Pindahkan Absen bila perlu dipindah.'
  }

  if (date < period.startDate) {
    return `Tanggal ini sebelum Periode ${period.periodNo} dimulai (${formatDate(period.startDate)}).`
  }

  if (period.actualEndDate) {
    if (date > period.actualEndDate) {
      return `Tanggal ini setelah Periode ${period.periodNo} selesai (${formatDate(period.actualEndDate)}).`
    }
    return null
  }

  const next = nextPeriodOf(period, classPeriods)
  if (next && date >= next.startDate) {
    return `Tanggal ini sudah masuk Periode ${next.periodNo}, yang mulai ${formatDate(next.startDate)}.`
  }

  return null
}
