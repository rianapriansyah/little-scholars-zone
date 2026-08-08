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
export const DAILY_REPORT_ENABLED = false

/**
 * TEMPORARY, this session only. Classrooms are normally treated as Monday–Friday only (see
 * isWitaClassDay in classStatus.ts), so visiting Kelas Saya on a weekend shows no classes at
 * all. The owner asked to see today's classes anyway, to check the attendance buttons over the
 * weekend. Set back to false once this session ends — nothing else needs to change.
 */
export const IGNORE_WEEKDAY_FOR_TESTING = true
