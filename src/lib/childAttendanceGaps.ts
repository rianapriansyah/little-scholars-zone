import { supabase } from './supabase'
import type { Result } from './result'
import { teacherDisplayName } from './teacherName'
import { getTodaysClassEndInWita } from './classStatus'

/**
 * One enrolled child in one of a day's classes, carrying the two facts that decide whether
 * their attendance is genuinely outstanding. Flat rather than nested so the grouping below
 * stays a pure function over plain data.
 */
export type ClassRosterRow = {
  classroomTeacherId: string
  /** The billed program. child_attendances keys off this, not off the teaching group. */
  classroomId: string
  classroomLabel: string
  teacherName: string
  timeStart: string
  timeEnd: string
  childId: string
  childName: string
  /** When the child joined this teaching group — a later date is not theirs to fill. */
  startedAt: string
  /** A learning period covers the date, so record_attendance would accept the day. */
  hasCoveringPeriod: boolean
  /** A child_attendances row already exists for (child, classroom, date). */
  isFilled: boolean
}

export type UnfilledStudent = {
  childId: string
  childName: string
}

export type ClassAttendanceGap = {
  classroomTeacherId: string
  classroomId: string
  classroomLabel: string
  teacherName: string
  timeStart: string
  timeEnd: string
  /** Children whose attendance for the date is still missing, by name. */
  unfilled: UnfilledStudent[]
  /** How many children could have had attendance recorded at all — the denominator. */
  eligibleCount: number
}

/**
 * Collapses a day's roster rows into one entry per class, listing only the children still
 * missing attendance. Classes with nothing outstanding drop out entirely, so the result is
 * already the "needs filling" list rather than something the caller has to filter again.
 *
 * Two children are skipped before anything is counted, both for the same reason the teacher's
 * own Laporan Harian roster skips them — their day cannot be filed at all, so listing it as
 * outstanding would be an instruction to do something impossible:
 *   - enrolled into the group after `date` (the save RPCs refuse a report dated before it)
 *   - no learning period covering `date` (record_attendance refuses the day outright)
 */
export function groupUnfilledAttendance(rows: readonly ClassRosterRow[], date: string): ClassAttendanceGap[] {
  const byClass = new Map<string, ClassAttendanceGap>()

  for (const row of rows) {
    if (row.startedAt > date) continue
    if (!row.hasCoveringPeriod) continue

    let gap = byClass.get(row.classroomTeacherId)
    if (!gap) {
      gap = {
        classroomTeacherId: row.classroomTeacherId,
        classroomId: row.classroomId,
        classroomLabel: row.classroomLabel,
        teacherName: row.teacherName,
        timeStart: row.timeStart,
        timeEnd: row.timeEnd,
        unfilled: [],
        eligibleCount: 0,
      }
      byClass.set(row.classroomTeacherId, gap)
    }

    gap.eligibleCount += 1
    if (!row.isFilled) gap.unfilled.push({ childId: row.childId, childName: row.childName })
  }

  const gaps = [...byClass.values()].filter((gap) => gap.unfilled.length > 0)
  for (const gap of gaps) gap.unfilled.sort((a, b) => a.childName.localeCompare(b.childName))
  // Chronological, so the day reads top-to-bottom the way it ran — which also puts whatever is
  // already overdue above the classes that have yet to happen.
  gaps.sort(
    (a, b) => a.timeStart.localeCompare(b.timeStart) || a.classroomLabel.localeCompare(b.classroomLabel),
  )
  return gaps
}

/**
 * Only the classes whose scheduled end has already passed. Attendance is filled right after
 * class, so a roster left empty by a class that hasn't finished yet isn't a gap at all — it is
 * simply a class that has not happened. Listing those would bury the handful of rosters genuinely
 * missed under every class still to come that day.
 *
 * `now` is a parameter rather than read internally so this stays a pure function of its inputs,
 * same reasoning as findIncompleteTeacherAttendance and the rest of classStatus.ts's window checks.
 *
 * getTodaysClassEndInWita returns null on a WITA weekend, which doubles as the weekend guard for
 * free — nothing is ever listed on a day classes don't run.
 */
export function selectEndedClassAttendanceGaps(
  gaps: readonly ClassAttendanceGap[],
  now: Date,
): ClassAttendanceGap[] {
  return gaps.filter((gap) => {
    const scheduledEnd = getTodaysClassEndInWita(gap.timeEnd, now)
    return scheduledEnd !== null && scheduledEnd.getTime() <= now.getTime()
  })
}

/** child_id + classroom_id, the pair child_attendances and learning periods are both keyed by. */
function childClassroomKey(childId: string, classroomId: string): string {
  return `${childId}|${classroomId}`
}

type ClassMeta = {
  classroomId: string
  classroomLabel: string
  teacherName: string
  timeStart: string
  timeEnd: string
}

/**
 * Every class running on `date` that still has students without attendance recorded.
 *
 * Four queries rather than one view: attendance is keyed by program (child, classroom, date)
 * while enrollment hangs off the teaching group (classroom_teacher), and the learning-period
 * check needs a third table again — joining all of that in Postgrest's embedding syntax would
 * not survive the first schema change. Assembled client-side instead, by the pure function above.
 *
 * Only active, billable classrooms are considered: is_billable excludes internal work programs
 * (cleaning duty, content creation), which no child is ever enrolled into.
 */
export async function fetchUnfilledClassAttendance(date: string): Promise<Result<ClassAttendanceGap[]>> {
  const [groupsRes, enrollmentsRes, periodsRes, attendancesRes] = await Promise.all([
    supabase
      .from('classroom_teachers')
      .select(
        'id, classroom_id, classrooms(label, time_start, time_end, active, is_billable), teachers(full_name, call_name)',
      ),
    supabase
      .from('children_classrooms')
      .select('classroom_teacher_id, child_id, started_at, children(full_name)')
      .is('ended_at', null),
    // Mirrors fetchPeriodsCoveringDate's window: started by `date`, and not already run out
    // before it. An open period has no end date yet, so it covers everything from its start on.
    supabase
      .from('learning_period_status')
      .select('child_id, classroom_id')
      .lte('start_date', date)
      .or(`actual_end_date.is.null,actual_end_date.gte.${date}`),
    supabase.from('child_attendances').select('child_id, classroom_id').eq('attendance_date', date),
  ])

  const error = groupsRes.error ?? enrollmentsRes.error ?? periodsRes.error ?? attendancesRes.error
  if (error) return { ok: false, error: error.message }

  const classes = new Map<string, ClassMeta>()
  for (const group of groupsRes.data ?? []) {
    const classroom = group.classrooms as unknown as
      | { label: string; time_start: string; time_end: string; active: boolean; is_billable: boolean }
      | null
    const teacher = group.teachers as unknown as { full_name: string; call_name: string | null } | null
    if (!classroom || !classroom.active || !classroom.is_billable) continue

    classes.set(group.id, {
      classroomId: group.classroom_id,
      classroomLabel: classroom.label,
      teacherName: teacher ? teacherDisplayName(teacher) : '—',
      timeStart: classroom.time_start,
      timeEnd: classroom.time_end,
    })
  }

  const covered = new Set<string>()
  for (const row of periodsRes.data ?? []) {
    if (row.child_id && row.classroom_id) covered.add(childClassroomKey(row.child_id, row.classroom_id))
  }

  const filled = new Set<string>()
  for (const row of attendancesRes.data ?? []) {
    filled.add(childClassroomKey(row.child_id, row.classroom_id))
  }

  const rows: ClassRosterRow[] = []
  for (const enrollment of enrollmentsRes.data ?? []) {
    const meta = classes.get(enrollment.classroom_teacher_id)
    if (!meta) continue
    const child = enrollment.children as unknown as { full_name: string } | null
    const key = childClassroomKey(enrollment.child_id, meta.classroomId)

    rows.push({
      classroomTeacherId: enrollment.classroom_teacher_id,
      classroomId: meta.classroomId,
      classroomLabel: meta.classroomLabel,
      teacherName: meta.teacherName,
      timeStart: meta.timeStart,
      timeEnd: meta.timeEnd,
      childId: enrollment.child_id,
      childName: child?.full_name ?? '—',
      startedAt: enrollment.started_at,
      hasCoveringPeriod: covered.has(key),
      isFilled: filled.has(key),
    })
  }

  return { ok: true, data: groupUnfilledAttendance(rows, date) }
}
