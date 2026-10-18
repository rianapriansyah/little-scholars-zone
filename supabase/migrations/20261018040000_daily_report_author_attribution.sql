-- Parents see who actually taught their child, not who the class is assigned to.
--
-- daily_report_for_attendance has always resolved the author through classroom_teachers ->
-- teachers, i.e. the group's ASSIGNED teacher (20261002010000). That was correct while only the
-- assigned teacher could write a report. Now that a substitute can, the same join would show a
-- parent their regular teacher's name over a note she did not write — which is both dishonest to
-- the parent and unfair to the teacher being credited.
--
-- WHY NOT created_by (the obvious candidate, rejected):
-- created_by is only ever written in the INSERT arm of the three save RPCs; every
-- ON CONFLICT DO UPDATE arm leaves it untouched (20261001020000:84-92 and :141-144). So if the
-- assigned teacher saved a mood draft at 08:10 and then went home ill, the substitute's note lands
-- on a row whose created_by is the absent teacher, and the parent sees exactly the wrong name
-- again. save_daily_report_mood and save_daily_report_items also create rows carrying no note at
-- all, so created_by routinely names someone who wrote nothing.
--
-- So: a new submitted_by, stamped by submit_daily_report beside submitted_at. Parents only ever
-- see submitted reports (parent_select_submitted_children_daily_reports), so "who sent it" is
-- precisely the question worth answering, and submitting is a single write site that cannot drift
-- the way an upsert's INSERT arm does. submit_daily_report's existing early return for an
-- already-submitted report is kept, so a second Kirim cannot rewrite the author.
--
-- created_by stays exactly as it is, as the audit trail of who opened the row.
--
-- The resolution order is submitted_by -> created_by -> assigned teacher. The two fallbacks matter:
-- an admin submitting on a teacher's behalf has no `teachers` row and falls through, and reports
-- submitted before this migration have no submitted_by at all.

ALTER TABLE public.children_daily_reports
  ADD COLUMN submitted_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.children_daily_reports.submitted_by IS
  'Who pressed Kirim — the honest author of what a parent reads, which is not necessarily the '
  'group''s assigned teacher once a substitute can fill the report. Stamped by submit_daily_report '
  'and never rewritten by a later submit. NULL for reports submitted before this column existed, '
  'and for an admin submission by someone with no teachers row; daily_report_for_attendance falls '
  'back to created_by and then to the assigned teacher.';

-- ---------------------------------------------------------------------------
-- Stamp it. Body is otherwise the version from 20261018020000_substitution_write_gates.sql.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_daily_report(p_report_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_teacher_id uuid;
  v_report_date date;
  v_submitted_at timestamptz;
BEGIN
  SELECT classroom_teacher_id, report_date, submitted_at
    INTO v_classroom_teacher_id, v_report_date, v_submitted_at
    FROM public.children_daily_reports
    WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  IF NOT public.can_write_daily_report(v_classroom_teacher_id, v_report_date) THEN
    RAISE EXCEPTION 'Not authorised to submit reports for this class';
  END IF;

  -- Unchanged, and load-bearing for attribution: a re-submit returns the original timestamp
  -- without touching the row, so submitted_by records the first sender for good.
  IF v_submitted_at IS NOT NULL THEN
    RETURN v_submitted_at;
  END IF;

  UPDATE public.children_daily_reports
    SET submitted_at = now(), submitted_by = auth.uid()
    WHERE id = p_report_id
    RETURNING submitted_at INTO v_submitted_at;

  RETURN v_submitted_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- Resolve the author, and let the substitute read back her own work.
--
-- Signature and returned columns are unchanged, so src/types/database.ts, fetchDailyReportForAttendance
-- and teacherDisplayName() all keep working untouched — only *which* teacher the two name columns
-- describe changes.
--
-- The author is picked in a LATERAL with an explicit priority, not with two independent COALESCEs
-- over separate joins: COALESCE(ts.full_name, tc.full_name, ta.full_name) paired with
-- COALESCE(ts.call_name, tc.call_name, ta.call_name) can take the full name from one teacher and
-- the call name from another whenever one of them has a NULL call_name, and print "Bu Rina" beside
-- the wrong formal name. Taking one row keeps the pair consistent.
-- ---------------------------------------------------------------------------

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
    author.full_name,
    author.call_name
  FROM public.children_daily_reports r
  JOIN public.classroom_teachers ct ON ct.id = r.classroom_teacher_id
  -- LEFT: a deleted teacher must not take the report down with them.
  LEFT JOIN LATERAL (
    SELECT candidate.full_name, candidate.call_name
    FROM (
      SELECT 1 AS prio, ts.full_name, ts.call_name
        FROM public.teachers ts WHERE ts.auth_user_id = r.submitted_by
      UNION ALL
      SELECT 2 AS prio, tc.full_name, tc.call_name
        FROM public.teachers tc WHERE tc.auth_user_id = r.created_by
      UNION ALL
      SELECT 3 AS prio, ta.full_name, ta.call_name
        FROM public.teachers ta WHERE ta.id = ct.teacher_id
    ) candidate
    ORDER BY candidate.prio
    LIMIT 1
  ) author ON true
  WHERE r.child_id = p_child_id
    AND ct.classroom_id = p_classroom_id
    AND r.report_date = p_report_date
    AND (
      (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
      OR r.classroom_teacher_id IN (SELECT public.teacher_classroom_teacher_ids(auth.uid()))
      -- The substitute reads back the day she covered, and only that day.
      OR public.is_substitute_for(r.classroom_teacher_id, r.report_date)
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
  'children_daily_reports'' RLS: admin sees all, a teacher their own groups, a substitute the day '
  'she covered, a parent their own children and only once submitted. Exists because a parent '
  'cannot read either side of that join — classroom_teachers only while the enrolment is current, '
  'teachers not at all. The two name columns describe whoever actually sent the report '
  '(submitted_by, then created_by, then the group''s assigned teacher), not the assigned teacher, '
  'so a substitute''s note is credited to her.';

GRANT EXECUTE ON FUNCTION public.daily_report_for_attendance(uuid, uuid, date) TO authenticated, service_role;
