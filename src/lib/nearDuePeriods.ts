import { isNearingEnd } from './attendanceQuota'
import { groupPeriodsByChild } from './periodGrouping'
import type { LearningPeriodListEntry } from '../types/attendance'

/**
 * What the dashboard treats as "hampir habis": five guaranteed days left or fewer.
 *
 * Deliberately its own constant rather than isNearingEnd's default, which is 3 and governs the
 * urgency chips on Periode Belajar, the family tab and the program cards. The card is a renewal
 * queue — it has to open the conversation early enough that the family can pay before the child
 * runs out — while those chips are a glance at one period, so the wider window here is the point
 * rather than a drift the two should be reconciled into.
 */
export const NEAR_DUE_DAYS_REMAINING = 5

/** One near-due program of a child: which class, and how many days are left in it. */
export type NearDueProgram = {
  classroomId: string
  classroomLabel: string
  /** Can be 0, or negative if a day was recorded past the quota before the period closed. */
  daysRemaining: number
}

export type NearDueChild = {
  childId: string
  childName: string
  /** Only the programs at or under the threshold — the ones there is something to do about. */
  programs: NearDueProgram[]
  /** The most pressing of them, which is what the list is ordered by. */
  soonestDaysRemaining: number
}

/**
 * Children with at least one running period close to running out, soonest first — the renewal
 * queue, as a dashboard card.
 *
 * Filtered per program, not per child: a child with 2 days left in Bimba and 18 in Calistung is
 * listed for Bimba alone. Showing the 18 as well would read as two things to re-sell when only
 * one is urgent, and the admin would have to work out which.
 *
 * Closed periods are skipped even though a caller fetching only open ones never supplies them,
 * because a closed period has nothing left to run out and silently counting one would put a child
 * in the queue who has already been dealt with.
 */
export function selectNearDueChildren(
  periods: LearningPeriodListEntry[],
  threshold: number = NEAR_DUE_DAYS_REMAINING,
): NearDueChild[] {
  const children: NearDueChild[] = []

  for (const child of groupPeriodsByChild(periods)) {
    const programs: NearDueProgram[] = []
    for (const program of child.programs) {
      // daysRemaining is null exactly when nothing of this program's is open; groupPeriodsByProgram
      // has already taken the min across its open periods, so this is the one number that matters.
      const { daysRemaining } = program
      if (!program.isActive || daysRemaining === null) continue
      if (!isNearingEnd({ daysRemaining }, threshold)) continue
      programs.push({
        classroomId: program.classroomId,
        classroomLabel: program.classroomLabel,
        daysRemaining,
      })
    }
    if (programs.length === 0) continue

    programs.sort((a, b) => a.daysRemaining - b.daysRemaining || a.classroomLabel.localeCompare(b.classroomLabel))
    children.push({
      childId: child.childId,
      childName: child.childName,
      programs,
      soonestDaysRemaining: programs[0].daysRemaining,
    })
  }

  // Re-sorted on the near-due programs rather than inheriting groupPeriodsByChild's order, which
  // ranks on every open period a child holds. The two agree today — a child's most pressing period
  // is by definition one of the near-due ones — but relying on that would make this list's
  // ordering depend on a detail of the grid's.
  children.sort((a, b) => a.soonestDaysRemaining - b.soonestDaysRemaining || a.childName.localeCompare(b.childName))
  return children
}
