-- Reverts the guru pengganti feature (20261018010000, 20261018020000, 20261018030000,
-- 20261018040000) in full, at the owner's request: the approach is being rethought from scratch,
-- so the half-built foundation comes out rather than sitting in the schema unused.
--
-- Nothing is lost. Before this ran, the live project held 0 rows in
-- classroom_teachers_substitutions and 0 children_daily_reports with submitted_by set, so no
-- coverage record and no attribution has ever existed in production. Reports, attendance and
-- enrolments are untouched by this file — the feature never moved any of them, which was the point
-- of keying coverage to its own table in the first place.
--
-- Order matters here:
--   1. restore the six function bodies FIRST, so nothing still calls the objects dropped below;
--   2. drop the policies that reference the predicates and set helpers;
--   3. drop the table (its own policies and trigger go with it);
--   4. drop the functions, then the index, then the column.
--
-- Everything is guarded with IF EXISTS so this file is safe to re-run and safe on a database that
-- never had the feature applied. The restored bodies below are byte-identical to their definitions
-- in 20260803010000, 20261001010000, 20261001020000, 20260930010000 and 20261002010000.

-- ---------------------------------------------------------------------------
-- 1. Restore the callers to the 1-argument gates
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_attendance(
  p_child_id uuid,
  p_classroom_id uuid,
  p_date date,
  p_status text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_id uuid;
  v_attendance_id uuid;
  v_guaranteed smallint;
  v_consumed int;
BEGIN
  IF NOT public.can_record_attendance(p_classroom_id) THEN
    RAISE EXCEPTION 'Not authorised to record attendance for this classroom';
  END IF;

  IF p_status NOT IN ('present', 'absent', 'sick') THEN
    RAISE EXCEPTION 'Unknown attendance status: %', p_status;
  END IF;

  -- children_classrooms enrols into a (classroom, teacher) pair, so the classroom only comes
  -- out of the join through classroom_teachers.
  IF NOT EXISTS (
    SELECT 1
    FROM public.children_classrooms cc
    JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
    WHERE cc.child_id = p_child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = p_classroom_id
  ) THEN
    RAISE EXCEPTION 'Child is not actively enrolled in this classroom';
  END IF;

  -- A correction stays in the period it was originally filed against, even once that period
  -- has closed. Only a genuinely new date needs an open period to draw from.
  SELECT ca.learning_period_id INTO v_period_id
    FROM public.child_attendances ca
    WHERE ca.child_id = p_child_id
      AND ca.classroom_id = p_classroom_id
      AND ca.attendance_date = p_date;

  IF v_period_id IS NULL THEN
    SELECT lp.id INTO v_period_id
      FROM public.learning_periods lp
      WHERE lp.child_id = p_child_id
        AND lp.classroom_id = p_classroom_id
        AND lp.closed_at IS NULL
      ORDER BY lp.period_no
      LIMIT 1;

    IF v_period_id IS NULL THEN
      RAISE EXCEPTION 'No open learning period for this child in this classroom; create one first';
    END IF;
  END IF;

  INSERT INTO public.child_attendances (
    learning_period_id, child_id, classroom_id, attendance_date, status, note, recorded_by
  )
  VALUES (v_period_id, p_child_id, p_classroom_id, p_date, p_status, p_note, auth.uid())
  ON CONFLICT ON CONSTRAINT child_attendances_child_classroom_date_key
  DO UPDATE SET
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    recorded_by = EXCLUDED.recorded_by,
    recorded_at = now()
  RETURNING id INTO v_attendance_id;

  SELECT lp.guaranteed_days INTO v_guaranteed
    FROM public.learning_periods lp WHERE lp.id = v_period_id;

  SELECT count(*) INTO v_consumed
    FROM public.child_attendances ca
    WHERE ca.learning_period_id = v_period_id
      AND ca.status <> 'sick';

  -- `closed_at IS NULL` keeps this idempotent: re-submitting the closing date is a no-op
  -- rather than bumping the timestamp.
  IF v_consumed >= v_guaranteed THEN
    UPDATE public.learning_periods
      SET closed_at = now(), actual_end_date = p_date
      WHERE id = v_period_id AND closed_at IS NULL;
  END IF;

  RETURN v_attendance_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_daily_report_mood(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_mood_arrival text DEFAULT NULL,
  p_mood_studying text DEFAULT NULL,
  p_mood_departure text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Not authorised to write reports for this class';
  END IF;

  IF p_mood_arrival IS NOT NULL AND p_mood_arrival NOT IN ('senang', 'biasa', 'sedih') THEN
    RAISE EXCEPTION 'Unknown mood_arrival: %', p_mood_arrival;
  END IF;
  IF p_mood_studying IS NOT NULL AND p_mood_studying NOT IN ('senang', 'biasa', 'sedih') THEN
    RAISE EXCEPTION 'Unknown mood_studying: %', p_mood_studying;
  END IF;
  IF p_mood_departure IS NOT NULL AND p_mood_departure NOT IN ('senang', 'biasa', 'sedih') THEN
    RAISE EXCEPTION 'Unknown mood_departure: %', p_mood_departure;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_classrooms cc
    WHERE cc.child_id = p_child_id
      AND cc.classroom_teacher_id = p_classroom_teacher_id
      AND cc.started_at <= p_report_date
      AND (cc.ended_at IS NULL OR cc.ended_at >= p_report_date)
  ) THEN
    RAISE EXCEPTION 'Child was not enrolled in this class on %', p_report_date;
  END IF;

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_id = p_child_id
      AND classroom_teacher_id = p_classroom_teacher_id
      AND report_date = p_report_date;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  -- The three moods are one unit (one Simpan button saves all three), so NULL here does mean
  -- "cleared" — but only for the moods. teacher_note is not in this statement at all.
  INSERT INTO public.children_daily_reports (
    child_id, classroom_teacher_id, report_date, created_by,
    mood_arrival, mood_studying, mood_departure
  )
  VALUES (
    p_child_id, p_classroom_teacher_id, p_report_date, auth.uid(),
    p_mood_arrival, p_mood_studying, p_mood_departure
  )
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_class_date_key
  DO UPDATE SET
    mood_arrival = EXCLUDED.mood_arrival,
    mood_studying = EXCLUDED.mood_studying,
    mood_departure = EXCLUDED.mood_departure
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_daily_report_teacher_note(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_teacher_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Not authorised to write reports for this class';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_classrooms cc
    WHERE cc.child_id = p_child_id
      AND cc.classroom_teacher_id = p_classroom_teacher_id
      AND cc.started_at <= p_report_date
      AND (cc.ended_at IS NULL OR cc.ended_at >= p_report_date)
  ) THEN
    RAISE EXCEPTION 'Child was not enrolled in this class on %', p_report_date;
  END IF;

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_id = p_child_id
      AND classroom_teacher_id = p_classroom_teacher_id
      AND report_date = p_report_date;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  -- A blank note is stored as NULL rather than '', so "has a note" is a plain IS NOT NULL.
  INSERT INTO public.children_daily_reports (
    child_id, classroom_teacher_id, report_date, created_by, teacher_note
  )
  VALUES (
    p_child_id, p_classroom_teacher_id, p_report_date, auth.uid(), NULLIF(btrim(p_teacher_note), '')
  )
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_class_date_key
  DO UPDATE SET teacher_note = EXCLUDED.teacher_note
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_daily_report_items(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_report_date date,
  p_entries jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report_id uuid;
  v_submitted_at timestamptz;
  v_is_admin boolean := (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
BEGIN
  IF NOT public.can_write_daily_report(p_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Not authorised to write reports for this class';
  END IF;

  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'p_entries must be a JSON array';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.children_classrooms cc
    WHERE cc.child_id = p_child_id
      AND cc.classroom_teacher_id = p_classroom_teacher_id
      AND cc.started_at <= p_report_date
      AND (cc.ended_at IS NULL OR cc.ended_at >= p_report_date)
  ) THEN
    RAISE EXCEPTION 'Child was not enrolled in this class on %', p_report_date;
  END IF;

  -- ON CONFLICT below can only merge one row per (report_id, curriculum_item_id); a payload
  -- listing the same materi twice is a client bug, not something to silently pick a winner for.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_entries) e
    GROUP BY e ->> 'curriculum_item_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'p_entries contains duplicate curriculum_item_id values';
  END IF;

  SELECT id, submitted_at INTO v_report_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE child_id = p_child_id
      AND classroom_teacher_id = p_classroom_teacher_id
      AND report_date = p_report_date;

  IF v_report_id IS NOT NULL AND v_submitted_at IS NOT NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Report was already submitted and can no longer be edited';
  END IF;

  INSERT INTO public.children_daily_reports (child_id, classroom_teacher_id, report_date, created_by)
  VALUES (p_child_id, p_classroom_teacher_id, p_report_date, auth.uid())
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_class_date_key
  DO UPDATE SET report_date = EXCLUDED.report_date
  RETURNING id INTO v_report_id;

  WITH incoming AS (
    SELECT (e ->> 'curriculum_item_id')::uuid AS curriculum_item_id,
           (e ->> 'mastery_level')::smallint AS mastery_level
    FROM jsonb_array_elements(p_entries) e
  )
  DELETE FROM public.daily_report_items dri
  WHERE dri.report_id = v_report_id
    AND NOT EXISTS (
      SELECT 1 FROM incoming i WHERE i.curriculum_item_id = dri.curriculum_item_id
    );

  INSERT INTO public.daily_report_items (report_id, curriculum_item_id, mastery_level)
  SELECT v_report_id,
         (e ->> 'curriculum_item_id')::uuid,
         (e ->> 'mastery_level')::smallint
  FROM jsonb_array_elements(p_entries) e
  ON CONFLICT (report_id, curriculum_item_id)
  DO UPDATE SET mastery_level = EXCLUDED.mastery_level;

  RETURN v_report_id;
END;
$$;

-- Back to the 20260930010000 body: no report_date lookup, and no submitted_by stamp.
CREATE OR REPLACE FUNCTION public.submit_daily_report(p_report_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_teacher_id uuid;
  v_submitted_at timestamptz;
BEGIN
  SELECT classroom_teacher_id, submitted_at
    INTO v_classroom_teacher_id, v_submitted_at
    FROM public.children_daily_reports
    WHERE id = p_report_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found';
  END IF;

  IF NOT public.can_write_daily_report(v_classroom_teacher_id) THEN
    RAISE EXCEPTION 'Not authorised to submit reports for this class';
  END IF;

  IF v_submitted_at IS NOT NULL THEN
    RETURN v_submitted_at;
  END IF;

  UPDATE public.children_daily_reports
    SET submitted_at = now()
    WHERE id = p_report_id
    RETURNING submitted_at INTO v_submitted_at;

  RETURN v_submitted_at;
END;
$$;

-- Back to the 20261002010000 body: the author is the group's assigned teacher again, and the
-- access clause has no substitute branch.
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

-- ---------------------------------------------------------------------------
-- 2. The substitute read policies on existing tables
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS teacher_select_substituted_child_attendances ON public.child_attendances;
DROP POLICY IF EXISTS teacher_select_substituted_daily_reports ON public.children_daily_reports;
DROP POLICY IF EXISTS teacher_select_substituted_classroom_teachers ON public.classroom_teachers;
DROP POLICY IF EXISTS teacher_select_substituted_classrooms ON public.classrooms;
DROP POLICY IF EXISTS teacher_select_substituted_children_classrooms ON public.children_classrooms;
DROP POLICY IF EXISTS teacher_select_substituted_children ON public.children;
DROP POLICY IF EXISTS teacher_select_substituted_learning_periods ON public.learning_periods;

-- ---------------------------------------------------------------------------
-- 3. The table, with its own policies and trigger
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS public.classroom_teachers_substitutions CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Functions, index, column
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.declare_substitution(uuid, text);
DROP FUNCTION IF EXISTS public.assign_substitution(uuid, uuid, date, boolean, text);
DROP FUNCTION IF EXISTS public.cancel_substitution(uuid);
DROP FUNCTION IF EXISTS public.substitutable_groups_today();
DROP FUNCTION IF EXISTS public.my_teaching_groups_for_date(date);
DROP FUNCTION IF EXISTS public.default_counts_for_pay(uuid, uuid);

DROP FUNCTION IF EXISTS public.can_record_attendance(uuid, date);
DROP FUNCTION IF EXISTS public.can_write_daily_report(uuid, date);

DROP FUNCTION IF EXISTS public.substituted_child_ids(uuid);
DROP FUNCTION IF EXISTS public.substituted_classroom_ids(uuid);
DROP FUNCTION IF EXISTS public.substituted_classroom_teacher_ids(uuid);
DROP FUNCTION IF EXISTS public.is_substitute_for_classroom(uuid, date);
DROP FUNCTION IF EXISTS public.is_substitute_for(uuid, date);

DROP FUNCTION IF EXISTS public.reject_self_substitution();

-- Added by 20261018010000 purely for the substitute predicates. It also speeds up the three
-- pre-existing teacher_* helpers, which all join teachers on auth_user_id, so if it is ever wanted
-- back it should be added deliberately on its own merits rather than as a leftover.
DROP INDEX IF EXISTS public.teachers_auth_user_id_idx;

-- Safe: 0 rows had a value, and neither submit_daily_report nor daily_report_for_attendance
-- references it any more after the restores above.
ALTER TABLE public.children_daily_reports DROP COLUMN IF EXISTS submitted_by;

-- Restore the 1-argument gates' own comments, which 20261018020000 rewrote to point at the
-- 2-argument forms that no longer exist.
COMMENT ON FUNCTION public.can_record_attendance(uuid) IS NULL;
COMMENT ON FUNCTION public.can_write_daily_report(uuid) IS NULL;
