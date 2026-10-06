/**
 * The date to pre-fill "Tanggal Mulai" with when an admin adds a child to a teaching group.
 *
 * The default matters more than the field does. A learning period can be backdated when the
 * paperwork is filed late, and before this existed the enrollment silently started on the day the
 * admin clicked Tambah — so a child whose period began 1 Oktober but who was assigned to a
 * teacher on the 5th could never have a daily report written for those first four days. Seven
 * enrollments across four teachers ended up in that state before anyone noticed.
 *
 * Two cases, because they want opposite answers:
 *
 *   first assignment in this classroom → the period's start date. The child has been attending
 *     since the program began; the enrollment should say so.
 *   already taught here before         → today. This is a move between teachers partway through a
 *     period, and the new teacher's stint starts now, not when the program did.
 *
 * The admin can always overrule it; this only decides what the field opens on.
 */
export function enrollmentStartDefault(params: {
  /** Start of the child's learning period in this classroom, or null if they hold none. */
  periodStart: string | null
  /** Whether the child already holds (or held) an enrollment in this same classroom. */
  hasPriorEnrollment: boolean
  /** Today, as an ISO date — callers pass todayIsoDateInWita(). */
  today: string
}): string {
  const { periodStart, hasPriorEnrollment, today } = params
  if (hasPriorEnrollment || !periodStart) return today
  return periodStart
}
