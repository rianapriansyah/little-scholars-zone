-- The two authorisation gates become date-aware, so a substitute can write a day's absensi and
-- Catatan Guru for the group she covered — and only for that day.
--
-- Both gates are extended as OVERLOADS rather than by changing the existing signatures, because
-- adding a parameter to a function is not something CREATE OR REPLACE can do (it would create an
-- overload anyway, leaving the old body in place) and because every one of the five callers
-- already receives the date it needs to pass. The existing bodies are reused verbatim via a call
-- to the 1-argument version, so the "admin, or a teacher assigned to this classroom/group" rule
-- stays defined in exactly one place.
--
-- The 1-argument gates are KEPT, because the 2-argument ones delegate to them: that is what keeps
-- "admin, or a teacher assigned to this classroom/group" written down once instead of twice.
-- Keeping them is safe on its own terms — they are pure boolean predicates that grant nothing by
-- being callable, and they are strictly stricter than the new ones.
--
-- The live database was checked before writing this (20260930010000's header records that
-- save_daily_report_mood once existed there with no file in this repo, so the repo is not evidence
-- of what exists):
--
--   SELECT p.oid::regprocedure FROM pg_proc p
--    WHERE p.prosrc ILIKE '%can_write_daily_report%'
--       OR p.prosrc ILIKE '%can_record_attendance%';
--
-- It returned exactly the five functions this migration recreates and nothing else, so there is no
-- unrecorded caller left behind on the old gate.
--
-- The five bodies below are otherwise copied unchanged from their live definitions
-- (20260803010000, 20261001010000, 20261001020000, 20260930010000); each changes exactly one
-- line, the gate call. Everything else still applies to a substitute: the child must have been
-- enrolled in the group on that date, a submitted report stays locked to non-admins, and the
-- enforce_child_present trigger from 20261001010000 still demands a 'present' attendance row for
-- the same classroom and date — which is why the teacher UI saves Kehadiran before the report,
-- and why a substitute needs the attendance gate as well as the report gate.

-- ---------------------------------------------------------------------------
-- The gates
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_record_attendance(p_classroom_id uuid, p_date date)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.can_record_attendance(p_classroom_id)
      OR public.is_substitute_for_classroom(p_classroom_id, p_date);
$$;

COMMENT ON FUNCTION public.can_record_attendance(uuid, date) IS
  'Whether the caller may record student attendance for this classroom on this date: admin, a '
  'teacher assigned to the classroom (any date), or the substitute covering a group in it on that '
  'date. The date-aware form — prefer it over the 1-argument version, which is deprecated.';

CREATE OR REPLACE FUNCTION public.can_write_daily_report(p_classroom_teacher_id uuid, p_report_date date)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.can_write_daily_report(p_classroom_teacher_id)
      OR public.is_substitute_for(p_classroom_teacher_id, p_report_date);
$$;

COMMENT ON FUNCTION public.can_write_daily_report(uuid, date) IS
  'Whether the caller may write this group''s daily report for this date: admin, the group''s own '
  'teacher (any date), or the substitute covering that group on that date. The date-aware form — '
  'prefer it over the 1-argument version, which is deprecated.';

GRANT EXECUTE ON FUNCTION public.can_record_attendance(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_daily_report(uuid, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.can_record_attendance(uuid) IS
  'The assignment-only half of the rule: admin, or a teacher assigned to this classroom. Callers '
  'should use can_record_attendance(uuid, date), which adds the day''s substitute and delegates '
  'here for this part.';

COMMENT ON FUNCTION public.can_write_daily_report(uuid) IS
  'The assignment-only half of the rule: admin, or this group''s own teacher. Callers should use '
  'can_write_daily_report(uuid, date), which adds the day''s substitute and delegates here for '
  'this part.';

-- ---------------------------------------------------------------------------
-- The five callers
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
  IF NOT public.can_record_attendance(p_classroom_id, p_date) THEN
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
  IF NOT public.can_write_daily_report(p_classroom_teacher_id, p_report_date) THEN
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
  IF NOT public.can_write_daily_report(p_classroom_teacher_id, p_report_date) THEN
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
  IF NOT public.can_write_daily_report(p_classroom_teacher_id, p_report_date) THEN
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

-- submit_daily_report resolves the group from the report row, so it has to read report_date out of
-- the same SELECT in order to have a date to authorise against.
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
