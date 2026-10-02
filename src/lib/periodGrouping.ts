import type { LearningPeriodListEntry } from '../types/attendance'
import type { PaymentStatus } from '../types/payment'

/** One program (classroom) a child holds periods in, newest period first. */
export type ChildProgramGroup = {
  classroomId: string
  classroomLabel: string
  /** Newest first (highest periodNo). In practice one, until a renewal adds a second. */
  periods: LearningPeriodListEntry[]
  /** True while any of its periods is still running. */
  isActive: boolean
  /**
   * Days left on the program's most pressing open period, or null when none is open. Drives the
   * urgency chip; a closed program has nothing left to run out.
   */
  daysRemaining: number | null
}

/** One row of the Periode Belajar grid: a child, with every program they hold beneath. */
export type ChildPeriodGroup = {
  childId: string
  childName: string
  programs: ChildProgramGroup[]
  /**
   * The whole point of the grid's ordering: how close this child is to running out of paid days,
   * taken from their most pressing open period. null when nothing of theirs is open — sorted last,
   * since there is nothing to re-sell.
   */
  soonestDaysRemaining: number | null
}

/**
 * Groups a child's periods by program (classroom), newest period first within each.
 *
 * Programs, not periods: "how many programs is this child enrolled in" is the question the detail
 * screen answers, and a renewal must not make a child look like it doubled. A classroom with two
 * periods is one program whose card holds both.
 *
 * Ordering: still-running programs first (that is what an admin acts on), then by how soon the
 * open period runs out, then by label so the list is stable between loads.
 */
export function groupPeriodsByProgram(periods: LearningPeriodListEntry[]): ChildProgramGroup[] {
  const byClassroom = new Map<string, ChildProgramGroup>()

  for (const period of periods) {
    const existing = byClassroom.get(period.classroomId)
    if (existing) {
      existing.periods.push(period)
    } else {
      byClassroom.set(period.classroomId, {
        classroomId: period.classroomId,
        classroomLabel: period.classroomLabel,
        periods: [period],
        isActive: false,
        daysRemaining: null,
      })
    }
  }

  const groups = [...byClassroom.values()]
  for (const group of groups) {
    group.periods.sort((a, b) => b.periodNo - a.periodNo)
    const open = group.periods.filter((p) => p.isActive)
    group.isActive = open.length > 0
    group.daysRemaining = open.length > 0 ? Math.min(...open.map((p) => p.daysRemaining)) : null
  }

  groups.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    if (a.daysRemaining !== b.daysRemaining) {
      if (a.daysRemaining === null) return 1
      if (b.daysRemaining === null) return -1
      return a.daysRemaining - b.daysRemaining
    }
    return a.classroomLabel.localeCompare(b.classroomLabel)
  })

  return groups
}

/**
 * Collapses period rows to one row per child — what the Periode Belajar grid lists. A child in two
 * programs appeared twice before this, which read as two different children at a glance and made
 * the row count meaningless as a headcount.
 *
 * Sorted the way the grid is meant to be read: whoever runs out of paid days first is at the top,
 * which is the renewal queue the screen exists for. Children with nothing open sort last.
 */
export function groupPeriodsByChild(periods: LearningPeriodListEntry[]): ChildPeriodGroup[] {
  const byChild = new Map<string, LearningPeriodListEntry[]>()
  for (const period of periods) {
    const existing = byChild.get(period.childId)
    if (existing) existing.push(period)
    else byChild.set(period.childId, [period])
  }

  const rows: ChildPeriodGroup[] = []
  for (const [childId, childPeriods] of byChild) {
    const programs = groupPeriodsByProgram(childPeriods)
    const open = childPeriods.filter((p) => p.isActive)
    rows.push({
      childId,
      childName: childPeriods[0].childName,
      programs,
      soonestDaysRemaining: open.length > 0 ? Math.min(...open.map((p) => p.daysRemaining)) : null,
    })
  }

  rows.sort((a, b) => {
    if (a.soonestDaysRemaining !== b.soonestDaysRemaining) {
      if (a.soonestDaysRemaining === null) return 1
      if (b.soonestDaysRemaining === null) return -1
      return a.soonestDaysRemaining - b.soonestDaysRemaining
    }
    return a.childName.localeCompare(b.childName)
  })

  return rows
}

/** How many of a child's periods are paid for, for the grid's Pembayaran column. */
export type PaymentTally = { paid: number; total: number }

/**
 * Counts paid periods across every period in `row`. A period with no payment row at all counts
 * toward the total but not toward `paid` — an invoice nobody has raised yet is still money owed,
 * so hiding it would flatter the figure.
 */
export function tallyPayments(
  row: ChildPeriodGroup,
  statusByPeriodId: Map<string, PaymentStatus>,
): PaymentTally {
  let paid = 0
  let total = 0
  for (const program of row.programs) {
    for (const period of program.periods) {
      total += 1
      if (statusByPeriodId.get(period.id) === 'paid') paid += 1
    }
  }
  return { paid, total }
}
