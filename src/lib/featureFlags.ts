/**
 * Short-lived toggles — grouped here so each one has exactly one place to flip back. Delete a
 * flag (and its usages) once the situation it exists for is over; don't let these accumulate.
 */

/**
 * Beta restriction (owner request, week of 2026-08-06): the center wants only teacher
 * attendance recorded for the first week of beta, so Laporan Harian is hidden from the teacher
 * portal's nav and from the "Kelas Saya" class cards. Set back to true to restore it — both
 * entry points (TeacherLayout, TeacherRosterPage) read this one flag.
 */
export const DAILY_REPORT_ENABLED = true

/**
 * Laporan Harian rework (owner request, 2026-09-30): the per-student sheet is being rebuilt around
 * mood and a teacher's note, so "Materi Hari Ini" and "Pratinjau untuk Orang Tua" are hidden
 * entirely from DailyReportStudentDialog for now. The materi data, RPC and components are all
 * untouched — set back to true to bring both sections (and the materi save path) back as they
 * were.
 */
export const DAILY_REPORT_MATERI_ENABLED = false

/**
 * Parent self-registration wizard (/register) and its "Daftar di sini" link on the login page.
 * Live as of 2026-08-10 — real transfer instructions are in PaymentStep.tsx (Bank Mandiri,
 * a/n Dewi Cahyanti Wahyu Ningsih) and the migration + submit-registration function are
 * already applied/deployed.
 */
export const PARENT_REGISTRATION_ENABLED = true
