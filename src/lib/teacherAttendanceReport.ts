import dayjs from 'dayjs'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from './supabase'
import { todayIsoDateInWita, witaWallClockTime } from './classStatus'
import { parseClassroomTeacherAttendanceStatus } from './classroomTeacherAttendance'
import { formatIdr } from './formatIdr'
import type { Result } from './result'
import type {
  ArrivalStatus,
  ClassroomTeacherAttendanceStatus,
  DepartureStatus,
} from '../types/classroomTeacherAttendance'

/** Matches the app's identity everywhere else — index.html's title and every PortalLayout header. */
const BUSINESS_NAME = 'Little Schoolars Zone'

const MONTH_LABELS_ID = [
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
    label: `${MONTH_LABELS_ID[ref.month()]} ${ref.year()}`,
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
}

export type ClassMinutesTotal = TeacherAttendanceReportClass & { totalMinutes: number }

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
): { classTotals: ClassMinutesTotal[]; grandTotalMinutes: number } {
  const minutesByKey = new Map<string, number>()
  for (const row of attendanceRows) {
    if (row.minutesTaught != null) minutesByKey.set(`${row.classroomTeacherId}|${row.sessionDate}`, row.minutesTaught)
  }

  const classTotals = classes.map((cls) => {
    let totalMinutes = 0
    for (const date of dates) {
      totalMinutes += minutesByKey.get(`${cls.classroomTeacherId}|${date}`) ?? 0
    }
    return { ...cls, totalMinutes }
  })

  const grandTotalMinutes = classTotals.reduce((sum, c) => sum + c.totalMinutes, 0)
  return { classTotals, grandTotalMinutes }
}

export type MonthlyAttendanceSummary = {
  label: string
  grandTotalMinutes: number
  /** IDR. null means the teacher has no rate configured — show a "belum diatur" hint instead of Rp 0. */
  estimatedPay: number | null
}

/**
 * The same Total Durasi / Estimasi numbers the PDF's grand summary prints, computed on their own
 * so a caller (the Unduh Laporan Kehadiran confirmation) can preview them without generating and
 * downloading the file. Goes through fetchMonthlyAttendance + summarizeAttendanceByClass exactly
 * like downloadTeacherAttendanceReport does, so the preview can never disagree with the PDF.
 */
export async function fetchMonthlyAttendanceSummary(params: {
  classes: TeacherAttendanceReportClass[]
  /** IDR per hour. null means not configured — estimatedPay comes back null too. */
  rate: number | null
  referenceDate?: string
}): Promise<Result<MonthlyAttendanceSummary>> {
  const { classes, rate } = params
  const { start, end, label } = currentMonthRange(params.referenceDate)

  const fetchResult = await fetchMonthlyAttendance(
    classes.map((c) => c.classroomTeacherId),
    start,
    end,
  )
  if (!fetchResult.ok) return fetchResult

  const dates = weekdaysInRange(start, end)
  const { grandTotalMinutes } = summarizeAttendanceByClass(classes, dates, fetchResult.data)

  return {
    ok: true,
    data: {
      label,
      grandTotalMinutes,
      estimatedPay: rate != null ? (grandTotalMinutes / 60) * rate : null,
    },
  }
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
  classes: TeacherAttendanceReportClass[]
  /** IDR per hour. null means not configured — the estimate line is skipped, not shown as Rp 0. */
  rate: number | null
  referenceDate?: string
}): Promise<Result<void>> {
  const { teacherName, classes, rate } = params
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
  const { classTotals, grandTotalMinutes } = summarizeAttendanceByClass(classes, dates, fetchResult.data)
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
        dayjs(date).format('DD-MM-YYYY'),
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

  // When a rate is set: "15 jam 7 menit x Rp 8.000" then the estimated pay, both bold so they
  // read as the bottom-line answer. Skipped (not shown as Rp 0) when the teacher has no rate
  // configured yet — see the Rate section on the Edit Guru dialog.
  const rateRows: (string | { content: string; styles?: Record<string, unknown> })[][] =
    rate != null
      ? [
          [
            'Total Keseluruhan dalam satuan Jam x Rate per Jam',
            `${formatHoursMinutes(grandTotalMinutes)} x ${formatIdr(rate)}`,
          ],
          [
            { content: `Estimasi yang akan diterima ${teacherName}`, styles: { fontStyle: 'bold' } },
            { content: formatIdr((grandTotalMinutes / 60) * rate), styles: { fontStyle: 'bold' } },
          ],
        ]
      : [
          [
            {
              content: 'Rate per jam belum diatur — atur di menu Guru untuk melihat estimasi gaji.',
              styles: { fontStyle: 'italic' },
            },
            '',
          ],
        ]

  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN_LEFT },
    head: [['Kelas', 'Total Durasi']],
    body: [
      ...classTotals.map((c) => [c.classroomLabel, `${c.totalMinutes} menit`]),
      [
        { content: 'Total Keseluruhan', styles: { fontStyle: 'bold' } },
        { content: `${grandTotalMinutes} menit`, styles: { fontStyle: 'bold' } },
      ],
      ...rateRows,
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 87, 76] },
  })

  const fileSafeName = teacherName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'guru'
  doc.save(`kehadiran-${fileSafeName}-${start.slice(0, 7)}.pdf`)

  return { ok: true, data: undefined }
}
