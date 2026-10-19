import type { SubstitutableClass, SubstitutableClassroom } from '../types/substitution'

/**
 * The pure half of Gantikan Kelas: how one flat list of coverable groups becomes the screen's two
 * dropdowns, and why a given group cannot be taken.
 *
 * Every rule here is re-checked inside declare_substitution, which is the real gate. The point of
 * having it client-side is to stop a teacher picking something that would be refused, and to say
 * why before she presses the button — the same relationship getClockInWindowStatus has to
 * clock_in_classroom_teacher.
 */

/** Why a group cannot be covered, or null when it can. One reason, in the order a teacher would ask. */
export type SubstituteBlockReason = 'teacher_present' | 'overlaps_own_class'

export const SUBSTITUTE_BLOCK_LABELS: Record<SubstituteBlockReason, string> = {
  teacher_present: 'Guru kelas ini sudah absen masuk',
  overlaps_own_class: 'Bentrok dengan jadwal Anda',
}

/**
 * The classes for the first dropdown: one entry per classroom, however many of its groups need
 * cover. Ordered by start time, which is how a teacher thinks about her day.
 */
export function classroomOptions(classes: SubstitutableClass[]): SubstitutableClassroom[] {
  const byId = new Map<string, SubstitutableClassroom>()
  for (const entry of classes) {
    if (byId.has(entry.classroomId)) continue
    byId.set(entry.classroomId, {
      classroomId: entry.classroomId,
      label: entry.classroomLabel,
      timeStart: entry.timeStart,
      timeEnd: entry.timeEnd,
    })
  }

  return [...byId.values()].sort(
    (a, b) => a.timeStart.localeCompare(b.timeStart) || a.label.localeCompare(b.label),
  )
}

/**
 * The teachers for the second dropdown: whoever holds a group in the chosen class. A classroom can
 * hold several teachers with six children each, so this is the choice that actually picks the
 * group — which is why coverage is keyed on classroom_teacher_id and not on the classroom.
 */
export function teacherOptions(
  classes: SubstitutableClass[],
  classroomId: string,
): SubstitutableClass[] {
  return classes
    .filter((entry) => entry.classroomId === classroomId)
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName))
}

/**
 * Whether two schedules collide. Half-open on purpose: a class ending at 10:00 and one starting at
 * 10:00 are back-to-back, which the app already treats as a legitimate chain (see
 * clock_out_and_continue_classroom_teacher), not a clash.
 *
 * Compares the HH:MM[:SS] strings directly — zero-padded 24-hour times sort lexicographically in
 * the same order they sort chronologically, which is why `time` columns can be compared as text
 * here and in the SQL that mirrors this.
 */
export function timeRangesOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null,
): boolean {
  // A class with no end time has no extent to overlap with; time_end is NOT NULL on classrooms
  // now, but older rows predate it and the type still admits null.
  if (aEnd === null || bEnd === null) return false
  return aStart < bEnd && bStart < aEnd
}

/**
 * Why this group is not coverable, or null if it is. `ownSchedules` is everything she already
 * holds that day — her own classes, and any coverage already taken — so one check catches both.
 *
 * Her own coverage of this very group is not a block: that is the "already declared" case, and the
 * screen takes her straight to the students instead.
 *
 * Another teacher covering the same group is not a block either. An absent teacher's children are
 * distributed among those who are left, so two or three substitutes on one group is the ordinary
 * case — otherSubstituteCount is shown to the teacher, not used to stop her.
 */
export function substituteBlockReason(
  entry: SubstitutableClass,
  ownSchedules: { classroomId: string; timeStart: string; timeEnd: string | null }[],
): SubstituteBlockReason | null {
  if (entry.coveredByMe) return null
  if (entry.teacherClockedIn) return 'teacher_present'

  const clashes = ownSchedules.some(
    (own) =>
      own.classroomId !== entry.classroomId &&
      timeRangesOverlap(own.timeStart, own.timeEnd, entry.timeStart, entry.timeEnd),
  )
  if (clashes) return 'overlaps_own_class'

  return null
}

/** "08:00–10:00", or just "08:00" for a class with no end time. */
export function formatClassTimeRange(timeStart: string, timeEnd: string | null): string {
  return `${timeStart.slice(0, 5)}${timeEnd ? `–${timeEnd.slice(0, 5)}` : ''}`
}
