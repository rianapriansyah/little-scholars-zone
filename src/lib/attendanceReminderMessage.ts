import { formatDate } from './formatDate'
import type { TeacherAttendanceGapGroup } from './childAttendanceGaps'

/**
 * The Ingatkan Guru text: one message per teacher, listing each of her classes with gaps and
 * exactly which children in it are still unmarked. Students are named rather than counted —
 * "2 siswa belum diisi" makes the teacher go and work out which two, while the names let her
 * open the app and fill them straight away.
 *
 * The date is spelled out even though the card only ever shows today: a WhatsApp message is read
 * whenever it is read, and a reminder that just says "hari ini" is wrong by the next morning.
 *
 * One message covering every class rather than one per class, because two notifications a few
 * seconds apart from the same admin read as a glitch, and a teacher who left two rosters unmarked
 * left them unmarked for the same reason.
 *
 * Takes a Pick rather than the whole group so the text can be tested without a phone number or an
 * id, the same shape teacherDisplayName and summarizeAttendances use.
 */
export function buildAttendanceReminderMessage(
  group: Pick<TeacherAttendanceGapGroup, 'teacherName' | 'classes'>,
  date: string,
): string {
  const lines = [`Hai ${group.teacherName},`, ``, `Absensi siswa berikut belum diisi untuk tanggal ${formatDate(date)}:`]

  for (const cls of group.classes) {
    lines.push(``, `${cls.classroomLabel} (${cls.timeStart.slice(0, 5)}–${cls.timeEnd.slice(0, 5)})`)
    // Numbering restarts per class: it is a list of that class's children, not a running total.
    cls.unfilled.forEach((student, index) => lines.push(`${index + 1}. ${student.childName}`))
  }

  lines.push(``, `Mohon diisi di Laporan Harian ya. Terima kasih!`)
  return lines.join('\n')
}
