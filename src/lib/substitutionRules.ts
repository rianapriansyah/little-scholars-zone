import type { SubstitutableGroup, TeachingGroup } from '../types/substitution'

/**
 * The client-side half of the guru pengganti rules. Every one of these is re-checked inside
 * declare_substitution / assign_substitution, which are the real gate — the point here is to stop
 * a teacher tapping something that would be refused, and to explain why it is refused before she
 * taps it. Same relationship getClockInWindowStatus has to clock_in_classroom_teacher.
 *
 * Kept pure and separate from substitutions.ts so the rules can be read, and tested, without a
 * Supabase client in the way.
 */

/** Why a group cannot be covered, or null when it can. One reason, in the order a teacher would ask. */
export type SubstituteBlockReason =
  | 'already_covered'
  | 'assigned_teacher_present'
  | 'overlaps_own_class'

export const SUBSTITUTE_BLOCK_LABELS: Record<SubstituteBlockReason, string> = {
  already_covered: 'Sudah digantikan guru lain',
  assigned_teacher_present: 'Guru kelas ini sudah absen masuk',
  overlaps_own_class: 'Bentrok dengan kelas Anda',
}

/**
 * Whether two schedules collide. Half-open on purpose: a class ending at 10:00 and one starting
 * at 10:00 are back-to-back, which the app already treats as a legitimate chain (see
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
 * The owner's pay rule, mirroring default_counts_for_pay in SQL: a teacher who already holds a
 * group in the covered classroom is already in that room for that hour and already paid, so
 * covering a second group there earns nothing extra. A teacher coming in from outside is paid.
 *
 * The question that actually matters is whether she was already being paid for that time slot;
 * same-classroom is its common case, and an admin can override the rest.
 */
export function defaultCountsForPay(ownClassroomIds: string[], coveredClassroomId: string): boolean {
  return !ownClassroomIds.includes(coveredClassroomId)
}

/**
 * Why this group is not coverable right now, or null if it is. `ownGroups` is everything she
 * already holds today — her own assignments and any coverage she has already taken — so the
 * overlap check catches both.
 */
export function substituteBlockReason(
  group: SubstitutableGroup,
  ownGroups: Pick<TeachingGroup, 'classroomId' | 'timeStart' | 'timeEnd'>[],
): SubstituteBlockReason | null {
  if (group.alreadyCovered) return 'already_covered'
  if (group.assignedTeacherClockedIn) return 'assigned_teacher_present'

  const clashes = ownGroups.some(
    (own) =>
      own.classroomId !== group.classroomId &&
      timeRangesOverlap(own.timeStart, own.timeEnd, group.timeStart, group.timeEnd),
  )
  if (clashes) return 'overlaps_own_class'

  return null
}

/**
 * How a class reads in the Laporan Harian / Kelas Saya pickers: "Kelas Pagi A · 08:00–10:00", with
 * the absent teacher appended when this is coverage. The teacher needs to see whose class it is,
 * because two groups of the same classroom share a label.
 */
export function teachingGroupLabel(group: TeachingGroup): string {
  const time = `${group.timeStart.slice(0, 5)}${group.timeEnd ? `–${group.timeEnd.slice(0, 5)}` : ''}`
  const base = `${group.label} · ${time}`
  if (!group.isSubstitute) return base
  return group.assignedTeacherName ? `${base} · Pengganti ${group.assignedTeacherName}` : `${base} · Pengganti`
}

/**
 * Own groups first, then coverage, each by start time — her own classes are the common case and
 * should not be pushed down the list by a one-day substitution. Deduplicated on
 * classroomTeacherId, defensively: a group cannot be both hers and covered by her (the
 * self-substitution trigger forbids it), but the two halves of my_teaching_groups_for_date are a
 * UNION ALL and a dropdown with a repeated key is worse than a redundant guard.
 */
export function sortTeachingGroups(groups: TeachingGroup[]): TeachingGroup[] {
  const seen = new Set<string>()
  const unique = groups.filter((group) => {
    if (seen.has(group.classroomTeacherId)) return false
    seen.add(group.classroomTeacherId)
    return true
  })

  return unique.sort((a, b) => {
    if (a.isSubstitute !== b.isSubstitute) return a.isSubstitute ? 1 : -1
    if (a.timeStart !== b.timeStart) return a.timeStart.localeCompare(b.timeStart)
    return a.label.localeCompare(b.label)
  })
}
