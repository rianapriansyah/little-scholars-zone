-- One attendance day's report, for the dialog behind a Riwayat Absensi row. Needed as an RPC
-- rather than a PostgREST query because the client-side join cannot be made correct for parents.
--
-- The dialog has to go attendance → report, and those two tables only meet through
-- classroom_teachers: attendance is keyed (child, classroom, date) and the report
-- (child, classroom_teacher, date). The obvious query embeds classroom_teachers with !inner and
-- filters on its classroom_id. Two things break that for a parent:
--
--   1. parent_select_classroom_teachers_of_own_children only exposes groups the child is in
--      RIGHT NOW (family_active_classroom_teacher_ids filters on ended_at IS NULL). A child who
--      has since moved class cannot see the old group, so !inner drops the row and every report
--      written by their previous teacher silently disappears. 16 enrolments have already ended,
--      so this is not hypothetical.
--   2. teachers has no parent policy at all, so the embedded teacher name always came back null
--      for parents — "Diisi oleh —" on every report.
--
-- Dropping the classroom filter instead is not an option: 12 children are enrolled in two
-- programs, and on a day they attend both there are two reports to tell apart.
--
-- So the join happens here, SECURITY DEFINER, and the WHERE clause below is the access control
-- rather than RLS. It mirrors the table's own policies exactly:
--   * admin            — everything, same as admin_all_children_daily_reports.
--   * teacher          — own groups, same as teacher_select_own_children_daily_reports.
--   * parent           — own children AND submitted only, same as
--                        parent_select_submitted_children_daily_reports. A draft stays invisible.
-- Anyone else matches nothing and gets an empty set.
--
-- The teacher's name comes back as its two raw columns rather than a display name, so
-- teacherDisplayName() in the client stays the single place that rule lives. Showing parents who
-- wrote their child's report is deliberate — they already know who teaches their child — and is
-- the one thing here they cannot read directly from the teachers table.

CREATE OR REPLACE FUNCTION public.daily_report_for_attendance(
  p_child_id uuid,
  p_classroom_id uuid,
  p_report_date date
)
RETURNS TABLE (
  id uuid,
  submitted_at timestamptz,
  mood_arrival text,
  mood_studying text,
  mood_departure text,
  teacher_note text,
  teacher_full_name text,
  teacher_call_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    r.id,
    r.submitted_at,
    r.mood_arrival,
    r.mood_studying,
    r.mood_departure,
    r.teacher_note,
    t.full_name,
    t.call_name
  FROM public.children_daily_reports r
  JOIN public.classroom_teachers ct ON ct.id = r.classroom_teacher_id
  -- LEFT: a deleted teacher must not take the report down with them.
  LEFT JOIN public.teachers t ON t.id = ct.teacher_id
  WHERE r.child_id = p_child_id
    AND ct.classroom_id = p_classroom_id
    AND r.report_date = p_report_date
    AND (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      OR r.classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid()))
      OR (
        r.submitted_at IS NOT NULL
        AND r.child_id IN (SELECT public.family_children_ids(auth.uid()))
      )
    )
  -- At most one row in practice (one report per child per group per day). Ordered and capped
  -- anyway so a child moved between two groups of the same classroom mid-day cannot make the
  -- caller choose arbitrarily — the sent one wins over a draft.
  ORDER BY r.submitted_at DESC NULLS LAST, r.id
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.daily_report_for_attendance(uuid, uuid, date) IS
  'The daily report belonging to one attendance day (child + classroom + date), joined through '
  'classroom_teachers. SECURITY DEFINER with its own access clause mirroring '
  'children_daily_reports'' RLS: admin sees all, a teacher their own groups, a parent their own '
  'children and only once submitted. Exists because a parent cannot read either side of that '
  'join — classroom_teachers only while the enrolment is current, teachers not at all.';

GRANT EXECUTE ON FUNCTION public.daily_report_for_attendance(uuid, uuid, date) TO authenticated, service_role;
