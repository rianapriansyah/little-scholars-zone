import dayjs from 'dayjs'
import { jsPDF } from 'jspdf'
import { autoTable } from 'jspdf-autotable'
import { supabase } from './supabase'
import { todayIsoDateInWita, witaWallClockTime } from './classStatus'
import { parseClassroomTeacherAttendanceStatus } from './classroomTeacherAttendance'
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

/**
 * Fetches the teacher's attendance for the current calendar month and downloads it as a PDF:
 * header (business name, teacher, period), then one table row per (weekday, class) in the
 * month. A day/class with no logged attendance still gets a row — "Belum Absen" — same
 * no-row-means-a-gap convention as the rest of this feature, so a forgotten punch is visible in
 * the printed report too, not silently skipped.
 */
export async function downloadTeacherAttendanceReport(params: {
  teacherName: string
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
  const body: string[][] = []
  let rowNo = 1
  for (const date of dates) {
    for (const cls of classes) {
      const status = byKey.get(`${cls.classroomTeacherId}|${date}`) ?? null
      const arrival = status?.arrivalStatus ?? 'missing'
      const departure = status?.departureStatus ?? 'missing'
      body.push([
        String(rowNo++),
        dayjs(date).format('DD-MM-YYYY'),
        cls.classroomLabel,
        formatClockTime(status?.clockedInAt ?? null),
        formatClockTime(status?.clockedOutAt ?? null),
        status?.minutesTaught != null ? `${status.minutesTaught} menit` : '—',
        summarizeKeterangan(arrival, departure),
      ])
    }
  }

  const doc = new jsPDF()
  doc.setFontSize(14)
  doc.text(BUSINESS_NAME, 14, 16)
  doc.setFontSize(11)
  doc.text(`Guru: ${teacherName}`, 14, 24)
  doc.text(`Periode: ${label}`, 14, 30)

  autoTable(doc, {
    startY: 36,
    head: [['No', 'Tanggal', 'Kelas', 'Jam Masuk', 'Jam Selesai', 'Durasi', 'Keterangan']],
    body,
    styles: { fontSize: 9 },
    headStyles: { fillColor: [46, 87, 76] },
  })

  const fileSafeName = teacherName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'guru'
  doc.save(`kehadiran-${fileSafeName}-${start.slice(0, 7)}.pdf`)

  return { ok: true, data: undefined }
}
