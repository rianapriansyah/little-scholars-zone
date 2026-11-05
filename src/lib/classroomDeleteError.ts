/**
 * Turns a refused `DELETE FROM classrooms` into a sentence that names what is actually holding
 * the classroom down.
 *
 * Nothing in the app checks before deleting — the delete is simply attempted and Postgres
 * refuses it with 23503 (foreign_key_violation) when any row still points at the classroom.
 * Four tables can do that, and none of them cascade:
 *
 *   children_classrooms     20260701120000_v1_core_tables.sql
 *   classroom_teachers      20260726030000_classroom_multi_teacher.sql
 *   learning_periods        20260803010000_learning_periods_attendance.sql
 *   registration_children   20260810010000_parent_registration.sql
 *
 * The old message blamed "riwayat pendaftaran siswa" for all four, which misled on the common
 * case: a classroom that only ever had a teacher assigned (classroom_teachers) and no student at
 * all is refused with exactly the same code, and the admin is told to look for enrollments that
 * do not exist. Each blocker now gets its own sentence, because each has a different way out.
 */

export type ClassroomDeleteDbError = {
  code?: string | null
  message: string
  details?: string | null
}

const FOREIGN_KEY_VIOLATION = '23503'

/**
 * Keyed by the referencing table, which is the one piece of machine-readable detail Postgres
 * gives us. A table missing here still gets a usable sentence from the fallback below, so adding
 * a fifth FK to classrooms degrades gracefully rather than reporting the wrong cause.
 */
const BLOCKER_MESSAGES: Record<string, string> = {
  children_classrooms:
    'Tidak dapat dihapus: kelas ini memiliki riwayat pendaftaran siswa. Nonaktifkan saja.',
  classroom_teachers:
    'Tidak dapat dihapus: kelas ini masih memiliki guru yang ditugaskan. Lepaskan penugasan gurunya dulu, atau nonaktifkan kelas saja.',
  learning_periods:
    'Tidak dapat dihapus: kelas ini memiliki periode belajar tercatat. Nonaktifkan saja.',
  registration_children:
    'Tidak dapat dihapus: kelas ini dipakai pada formulir pendaftaran orang tua. Nonaktifkan saja.',
}

/**
 * Postgres names the referencing table twice, in two different shapes:
 *   message: ...violates foreign key constraint "x_classroom_id_fkey" on table "children_classrooms"
 *   details: Key (id)=(...) is still referenced from table "children_classrooms".
 * `details` is the more reliable of the two, but PostgREST can withhold it depending on the
 * server's error-detail setting, so fall back to the message.
 */
function referencingTable(error: ClassroomDeleteDbError): string | null {
  const fromDetails = error.details?.match(/referenced from table "([^"]+)"/)
  if (fromDetails) return fromDetails[1]

  // Anchored to the constraint clause on purpose: the message opens with `update or delete on
  // table "classrooms"`, so a bare /on table "([^"]+)"/ matches the classroom being deleted
  // rather than the table blocking it.
  const fromMessage = error.message.match(/foreign key constraint "[^"]+" on table "([^"]+)"/)
  if (fromMessage) return fromMessage[1]

  return null
}

export function classroomDeleteErrorMessage(error: ClassroomDeleteDbError): string {
  if (error.code !== FOREIGN_KEY_VIOLATION) return error.message

  const table = referencingTable(error)
  if (table === null) {
    return 'Tidak dapat dihapus: kelas ini masih dipakai oleh data lain. Nonaktifkan saja.'
  }

  return (
    BLOCKER_MESSAGES[table] ??
    `Tidak dapat dihapus: kelas ini masih dipakai oleh data lain (${table}). Nonaktifkan saja.`
  )
}
