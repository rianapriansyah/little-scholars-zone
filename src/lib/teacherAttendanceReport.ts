import dayjs from 'dayjs'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from './supabase'
import { todayIsoDateInWita, witaWallClockTime } from './classStatus'
import { parseClassroomTeacherAttendanceStatus } from './classroomTeacherAttendance'
import { MONTH_NAMES_ID, formatDate } from './formatDate'
import { formatIdr } from './formatIdr'
import type { Result } from './result'
import type {
  ArrivalStatus,
  ClassroomTeacherAttendanceStatus,
  DepartureStatus,
} from '../types/classroomTeacherAttendance'

/** Matches the app's identity everywhere else — index.html's title and every PortalLayout header. */
const BUSINESS_NAME = 'Little Schoolars Zone'

/**
 * The calendar month containing `referenceDate` (default: today, in WITA — same convention as
 * the rest of the attendance feature). Callers on the Kehadiran Guru screen pass the admin's
 * selected sessionDate so the report/estimate track whichever month is picked, not just today's.
 */
export function currentMonthRange(referenceDate: string = todayIsoDateInWita()): {
  start: string
  end: string
  label: string
} {
  const ref = dayjs(referenceDate)
  return {
    start: ref.startOf('month').format('YYYY-MM-DD'),
    end: ref.endOf('month').format('YYYY-MM-DD'),
    label: `${MONTH_NAMES_ID[ref.month()]} ${ref.year()}`,
  }
}

/**
 * Monday–Friday dates between `start` and `end` inclusive — classrooms only run those days (see
 * isWitaClassDay in classStatus.ts), so weekends never appear as report rows.
 */
export function weekdaysInRange(start: string, end: string): string[] {
  const dates: string[] = []
  let cursor = dayjs(start)
  const last = dayjs(end)
  while (cursor.isBefore(last) || cursor.isSame(last, 'day')) {
    const day = cursor.day() // 0 = Sunday, 6 = Saturday
    if (day >= 1 && day <= 5) dates.push(cursor.format('YYYY-MM-DD'))
    cursor = cursor.add(1, 'day')
  }
  return dates
}

/** classroom_teacher_id + session_date → attendance status, for every class in the date range. */
export async function fetchMonthlyAttendance(
  classroomTeacherIds: string[],
  start: string,
  end: string,
): Promise<Result<ClassroomTeacherAttendanceStatus[]>> {
  if (classroomTeacherIds.length === 0) return { ok: true, data: [] }

  const { data, error } = await supabase
    .from('classroom_teachers_attendance_status')
    .select('*')
    .in('classroom_teacher_id', classroomTeacherIds)
    .gte('session_date', start)
    .lte('session_date', end)
    .order('session_date', { ascending: true })
  if (error) return { ok: false, error: error.message }

  const rows: ClassroomTeacherAttendanceStatus[] = []
  for (const row of data ?? []) {
    const status = parseClassroomTeacherAttendanceStatus(row)
    if (status) rows.push(status)
  }
  return { ok: true, data: rows }
}

function formatClockTime(iso: string | null): string {
  return iso ? witaWallClockTime(iso) : '—'
}

/** 907 → "15 jam 7 menit", 2400 → "40 jam", for the "jam x rate" summary line. */
export function formatHoursMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours} jam` : `${hours} jam ${minutes} menit`
}

/** One line of human-readable context — never used for payroll math, just for reading the PDF. */
function summarizeKeterangan(arrival: ArrivalStatus, departure: DepartureStatus): string {
  if (arrival === 'missing' && departure === 'missing') return 'Belum Absen'
  const notes: string[] = []
  if (arrival === 'late') notes.push('Telat')
  if (arrival === 'missing') notes.push('Belum Absen Masuk')
  if (departure === 'early') notes.push('Pulang Cepat')
  if (departure === 'overtime') notes.push('Over Time')
  if (departure === 'missing') notes.push('Belum Absen Selesai')
  return notes.length > 0 ? notes.join(', ') : 'Tepat Waktu'
}

export type TeacherAttendanceReportClass = {
  classroomTeacherId: string
  classroomLabel: string
  /**
   * IDR per hour for this class — classrooms.teacher_rate, not the teacher's own. null means it
   * has not been set yet: the minutes still count toward Total Durasi, but earn nothing and are
   * reported as missing rather than silently valued at zero.
   */
  rate: number | null
}

export type ClassMinutesTotal = TeacherAttendanceReportClass & {
  totalMinutes: number
  /** totalMinutes at this class's own rate, or null when it has none. */
  pay: number | null
}

/**
 * The single source of truth for "how many minutes did this teacher teach this month" — every
 * screen that shows a total (the PDF's tables, the PDF's grand summary, MyAttendancePage's Total
 * Durasi tile) must go through this, so they can never disagree the way they did when
 * MyAttendancePage summed raw attendance rows directly instead of going cell-by-cell like the
 * PDF does.
 *
 * Only counts a (class, date) cell when `date` is in `dates` — a stray attendance row that
 * doesn't land on one of those dates (e.g. a weekend test clock-in) is not a real class day and
 * must not silently inflate a total or an estimated payout.
 */
export function summarizeAttendanceByClass(
  classes: TeacherAttendanceReportClass[],
  dates: string[],
  attendanceRows: ClassroomTeacherAttendanceStatus[],
): {
  classTotals: ClassMinutesTotal[]
  grandTotalMinutes: number
  /**
   * Summed per class at each class's own rate, not from grandTotalMinutes — a teacher working two
   * classes at different rates has no single rate to multiply by. null when no class that has
   * worked minutes carries a rate, so the caller can say "belum diatur" instead of showing Rp 0.
   */
  estimatedPay: number | null
  /** Classes with minutes but no rate. Their time is in the total durasi but not in the money. */
  classesMissingRate: string[]
} {
  const minutesByKey = new Map<string, number>()
  for (const row of attendanceRows) {
    if (row.minutesTaught != null) minutesByKey.set(`${row.classroomTeacherId}|${row.sessionDate}`, row.minutesTaught)
  }

  const classTotals = classes.map((cls) => {
    let totalMinutes = 0
    for (const date of dates) {
      totalMinutes += minutesByKey.get(`${cls.classroomTeacherId}|${date}`) ?? 0
    }
    return { ...cls, totalMinutes, pay: cls.rate != null ? (totalMinutes / 60) * cls.rate : null }
  })

  const grandTotalMinutes = classTotals.reduce((sum, c) => sum + c.totalMinutes, 0)
  const payable = classTotals.filter((c) => c.pay !== null && c.totalMinutes > 0)
  const classesMissingRate = classTotals
    .filter((c) => c.rate === null && c.totalMinutes > 0)
    .map((c) => c.classroomLabel)

  return {
    classTotals,
    grandTotalMinutes,
    estimatedPay: payable.length > 0 ? payable.reduce((sum, c) => sum + (c.pay ?? 0), 0) : null,
    classesMissingRate,
  }
}

export type MonthlyAttendanceSummary = {
  label: string
  grandTotalMinutes: number
  /** IDR. null means no class they worked has a rate yet — show "belum diatur" instead of Rp 0. */
  estimatedPay: number | null
  /** Classes whose minutes are in grandTotalMinutes but not in estimatedPay, for want of a rate. */
  classesMissingRate: string[]
}

/**
 * The same Total Durasi / Estimasi numbers the PDF's grand summary prints, computed on their own
 * so a caller (the Unduh Laporan Kehadiran confirmation) can preview them without generating and
 * downloading the file. Goes through fetchMonthlyAttendance + summarizeAttendanceByClass exactly
 * like downloadTeacherAttendanceReport does, so the preview can never disagree with the PDF.
 */
export async function fetchMonthlyAttendanceSummary(params: {
  /** Each carries its own rate — see TeacherAttendanceReportClass. */
  classes: TeacherAttendanceReportClass[]
  referenceDate?: string
}): Promise<Result<MonthlyAttendanceSummary>> {
  const { classes } = params
  const { start, end, label } = currentMonthRange(params.referenceDate)

  const fetchResult = await fetchMonthlyAttendance(
    classes.map((c) => c.classroomTeacherId),
    start,
    end,
  )
  if (!fetchResult.ok) return fetchResult

  const dates = weekdaysInRange(start, end)
  const { grandTotalMinutes, estimatedPay, classesMissingRate } = summarizeAttendanceByClass(
    classes,
    dates,
    fetchResult.data,
  )

  return { ok: true, data: { label, grandTotalMinutes, estimatedPay, classesMissingRate } }
}

const MARGIN_LEFT = 14
const PAGE_BOTTOM_MARGIN = 16

/**
 * Fetches the teacher's attendance for the calendar month containing `referenceDate` (the
 * Kehadiran Guru screen's sessionDate picker; defaults to today) and downloads it as a PDF:
 * header (business name, teacher, period), then one table per class the teacher teaches — a
 * teacher with 4 classes gets 4 tables, each with its own "Total Durasi Mengajar" row — and
 * finally one small summary table totalling every class's minutes for the month, plus (when a
 * rate is configured) an estimated-pay line. A day with no logged attendance still gets a row
 * in its class's table — "Belum Absen" — same no-row-means-a-gap convention as the rest of this
 * feature, so a forgotten punch is visible in the printed report too, not silently skipped (and
 * doesn't count toward any total).
 */
export async function downloadTeacherAttendanceReport(params: {
  teacherName: string
  /** Each carries its own rate — see TeacherAttendanceReportClass. */
  classes: TeacherAttendanceReportClass[]
  referenceDate?: string
}): Promise<Result<void>> {
  const { teacherName, classes } = params
  const { start, end, label } = currentMonthRange(params.referenceDate)

  const fetchResult = await fetchMonthlyAttendance(
    classes.map((c) => c.classroomTeacherId),
    start,
    end,
  )
  if (!fetchResult.ok) return fetchResult

  const byKey = new Map<string, ClassroomTeacherAttendanceStatus>()
  for (const row of fetchResult.data) {
    byKey.set(`${row.classroomTeacherId}|${row.sessionDate}`, row)
  }

  const dates = weekdaysInRange(start, end)
  const { classTotals, grandTotalMinutes, estimatedPay, classesMissingRate } = summarizeAttendanceByClass(
    classes,
    dates,
    fetchResult.data,
  )
  const totalMinutesByClass = new Map(classTotals.map((c) => [c.classroomTeacherId, c.totalMinutes]))

  const doc = new jsPDF()
  doc.setFontSize(14)
  doc.text(BUSINESS_NAME, MARGIN_LEFT, 16)
  doc.setFontSize(11)
  doc.text(`Guru: ${teacherName}`, MARGIN_LEFT, 24)
  doc.text(`Periode: ${label}`, MARGIN_LEFT, 30)

  const pageHeight = doc.internal.pageSize.getHeight()
  let cursorY = 38

  /** Starts a new page if the next block wouldn't fit, so a heading is never stranded alone. */
  function ensureSpace(neededHeight: number) {
    if (cursorY + neededHeight > pageHeight - PAGE_BOTTOM_MARGIN) {
      doc.addPage()
      cursorY = 20
    }
  }

  for (const cls of classes) {
    const body: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = []
    let rowNo = 1
    for (const date of dates) {
      const status = byKey.get(`${cls.classroomTeacherId}|${date}`) ?? null
      const arrival = status?.arrivalStatus ?? 'missing'
      const departure = status?.departureStatus ?? 'missing'

      body.push([
        String(rowNo++),
        formatDate(date),
        formatClockTime(status?.clockedInAt ?? null),
        formatClockTime(status?.clockedOutAt ?? null),
        status?.minutesTaught != null ? `${status.minutesTaught} menit` : '—',
        summarizeKeterangan(arrival, departure),
      ])
    }
    // The table's own footer row — bold, spanning the first four columns as a label so the
    // total reads as a summary line, not just another day. Reads from the shared
    // summarizeAttendanceByClass result rather than re-accumulating, so this can never drift
    // from the grand summary table below or from what MyAttendancePage shows on screen.
    body.push([
      {
        content: 'Total Durasi Mengajar',
        colSpan: 4,
        styles: { fontStyle: 'bold', halign: 'right' },
      },
      { content: `${totalMinutesByClass.get(cls.classroomTeacherId) ?? 0} menit`, styles: { fontStyle: 'bold' } },
      '',
    ])

    ensureSpace(24)
    doc.setFontSize(11)
    doc.text(cls.classroomLabel, MARGIN_LEFT, cursorY)
    cursorY += 4

    autoTable(doc, {
      startY: cursorY,
      margin: { left: MARGIN_LEFT },
      head: [['No', 'Tanggal', 'Jam Masuk', 'Jam Selesai', 'Durasi', 'Keterangan']],
      body,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [46, 87, 76] },
    })

    cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12
  }

  // Grand summary: every class's monthly total in one place, plus the total across all of them.
  ensureSpace(30)
  doc.setFontSize(12)
  doc.text('Ringkasan Total Durasi Bulan Ini', MARGIN_LEFT, cursorY)
  cursorY += 4

  // The rate belongs to the class now, so there is no single "jam x rate" to print: each class
  // is priced on its own row and the estimate is their sum. A class with no rate set shows the
  // reason in its own cell rather than a blank, so an incomplete total explains itself.
  type Cell = string | { content: string; colSpan?: number; styles?: Record<string, unknown> }
  const summaryRows: Cell[][] = classTotals.map((c) => [
    c.classroomLabel,
    `${c.totalMinutes} menit`,
    c.rate != null ? formatIdr(c.rate) : '—',
    c.pay != null ? formatIdr(c.pay) : c.totalMinutes > 0 ? 'Rate belum diatur' : '—',
  ])

  summaryRows.push([
    { content: 'Total Keseluruhan', styles: { fontStyle: 'bold' } },
    { content: `${grandTotalMinutes} menit`, styles: { fontStyle: 'bold' } },
    '',
    {
      content: estimatedPay != null ? formatIdr(estimatedPay) : 'Belum bisa dihitung',
      styles: { fontStyle: 'bold' },
    },
  ])

  summaryRows.push([
    {
      content:
        estimatedPay != null
          ? `Estimasi yang akan diterima ${teacherName}: ${formatIdr(estimatedPay)}`
          : 'Rate per jam belum diatur di kelas manapun — atur di menu Kelas untuk melihat estimasi gaji.',
      colSpan: 4,
      styles: { fontStyle: estimatedPay != null ? 'bold' : 'italic' },
    },
  ])

  // Only when the number is real but incomplete: naming the classes left out stops the total
  // being read as the whole month's pay.
  if (estimatedPay != null && classesMissingRate.length > 0) {
    summaryRows.push([
      {
        content: `Belum termasuk ${classesMissingRate.join(', ')} — rate per jam belum diatur.`,
        colSpan: 4,
        styles: { fontStyle: 'italic' },
      },
    ])
  }

  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN_LEFT },
    head: [['Kelas', 'Total Durasi', 'Rate / Jam', 'Estimasi']],
    body: summaryRows,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 87, 76] },
  })

  const fileSafeName = teacherName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'guru'
  doc.save(`kehadiran-${fileSafeName}-${start.slice(0, 7)}.pdf`)

  return { ok: true, data: undefined }
}
