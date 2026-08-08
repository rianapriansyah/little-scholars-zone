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
 * the rest of the attendance feature). Deliberately the *current* month regardless of whatever
 * date is selected on the Kehadiran Guru screen; the report is always "this month so far/ahead",
 * not tied to the admin's date picker.
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
  if (arrival === 'late') notes.push('Terlambat')
  if (arrival === 'missing') notes.push('Belum Absen Masuk')
  if (departure === 'early') notes.push('Pulang Cepat')
  if (departure === 'missing') notes.push('Belum Absen Selesai')
  return notes.length > 0 ? notes.join(', ') : 'Tepat Waktu'
}

export type TeacherAttendanceReportClass = {
  classroomTeacherId: string
  classroomLabel: string
}

const MARGIN_LEFT = 14
const PAGE_BOTTOM_MARGIN = 16

/**
 * Fetches the teacher's attendance for the current calendar month and downloads it as a PDF:
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

  const classTotals: { classroomLabel: string; totalMinutes: number }[] = []

  for (const cls of classes) {
    let classTotalMinutes = 0
    const body: (string | { content: string; colSpan?: number; styles?: Record<string, unknown> })[][] = []
    let rowNo = 1
    for (const date of dates) {
      const status = byKey.get(`${cls.classroomTeacherId}|${date}`) ?? null
      const arrival = status?.arrivalStatus ?? 'missing'
      const departure = status?.departureStatus ?? 'missing'
      if (status?.minutesTaught != null) classTotalMinutes += status.minutesTaught

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
    // total reads as a summary line, not just another day.
    body.push([
      { content: 'Total Durasi Mengajar', colSpan: 4, styles: { fontStyle: 'bold', halign: 'right' } },
      { content: `${classTotalMinutes} menit`, styles: { fontStyle: 'bold' } },
      '',
    ])
    classTotals.push({ classroomLabel: cls.classroomLabel, totalMinutes: classTotalMinutes })

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
  const grandTotalMinutes = classTotals.reduce((sum, c) => sum + c.totalMinutes, 0)
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
