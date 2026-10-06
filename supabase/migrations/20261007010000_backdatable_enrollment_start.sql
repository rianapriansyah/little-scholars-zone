-- A teacher could not save Suasana Hati for a child who was plainly on her roster and plainly
-- marked hadir. The roster and the save disagreed about what "enrolled on this date" means:
--
--   the teacher's roster  → the child's learning period covers the date
--   save_daily_report_*   → children_classrooms.started_at <= date <= ended_at
--
-- A learning period can be backdated when an admin files it late; an enrollment could not.
-- enroll_child_in_classroom and switch_classroom both hardcoded current_date, so a child whose
-- period was correctly backdated to 1 Oktober got an enrollment starting the day the admin
-- happened to do the paperwork. Every report for the days in between was refused.
--
-- Two halves here: repair the enrollments already in that state, then let an admin set the date
-- so it cannot recur.
--
-- children_classrooms.started_at feeds nothing but this enrolment check — not billing, not the
-- quota, not teacher pay (those run off learning_periods, payment_periods and child_attendances).
-- So moving these dates cannot disturb anything else.

-- ---------------------------------------------------------------------------
-- 1. Repair the enrollments that start after attendance already recorded for them.
-- ---------------------------------------------------------------------------

-- Floored at the learning period's own start so a repair can never claim the child was enrolled
-- before the program was sold to them. In practice the floor never binds on today's data — every
-- affected period starts on or before its first uncovered day — but it keeps the rule honest.
--
-- Ayyubi Asyraf Kusuma's five August days are deliberately left alone. The owner confirmed those
-- are invalid: his real attendance starts 1 Oktober, and the August rows carry no daily report.
-- Pulling his enrollment back to 3 Agustus would carve that bad data into the enrollment record.
-- They are removed with delete_child_attendance instead — see 20261007020000.
UPDATE public.children_classrooms cc
   SET started_at = repair.new_start
  FROM (
    SELECT cc2.id AS enrollment_id,
           greatest(lp.start_date, u.first_uncovered) AS new_start
      FROM (
        SELECT ca.child_id, ca.classroom_id, min(ca.attendance_date) AS first_uncovered
          FROM public.child_attendances ca
         WHERE NOT EXISTS (
           SELECT 1
             FROM public.children_classrooms cc3
             JOIN public.classroom_teachers ct3 ON ct3.id = cc3.classroom_teacher_id
            WHERE cc3.child_id = ca.child_id
              AND ct3.classroom_id = ca.classroom_id
              AND cc3.started_at <= ca.attendance_date
              AND (cc3.ended_at IS NULL OR cc3.ended_at >= ca.attendance_date)
         )
           -- Ayyubi's invalid August days predate every real enrollment in this system by
           -- weeks; no legitimate backfill reaches further back than September.
           AND ca.attendance_date >= DATE '2026-09-01'
         GROUP BY ca.child_id, ca.classroom_id
      ) u
      JOIN public.children_classrooms cc2 ON cc2.child_id = u.child_id AND cc2.ended_at IS NULL
      JOIN public.classroom_teachers ct2
        ON ct2.id = cc2.classroom_teacher_id AND ct2.classroom_id = u.classroom_id
      JOIN LATERAL (
        SELECT lp2.start_date
          FROM public.learning_periods lp2
         WHERE lp2.child_id = u.child_id AND lp2.classroom_id = u.classroom_id
         ORDER BY lp2.start_date
         LIMIT 1
      ) lp ON true
  ) repair
 WHERE cc.id = repair.enrollment_id
   AND cc.started_at > repair.new_start;

-- ---------------------------------------------------------------------------
-- 2. Let the enrollment date be set.
-- ---------------------------------------------------------------------------

-- Adding a defaulted argument creates a second overload rather than replacing the old function,
-- which would leave every existing 2-arg call ambiguous. The old signatures go first.
DROP FUNCTION IF EXISTS public.enroll_child_in_classroom(uuid, uuid);
DROP FUNCTION IF EXISTS public.switch_classroom(uuid, uuid, text);

CREATE FUNCTION public.enroll_child_in_classroom(
  p_child_id uuid,
  p_classroom_teacher_id uuid,
  p_started_at date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_id uuid;
  v_max smallint;
  v_count int;
  v_started_at date := COALESCE(p_started_at, current_date);
  v_period_start date;
BEGIN
  SELECT ct.classroom_id, c.max_students_per_teacher
    INTO v_classroom_id, v_max
    FROM public.classroom_teachers ct
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.children_classrooms cc
    JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
    WHERE cc.child_id = p_child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = v_classroom_id
  ) THEN
    RAISE EXCEPTION 'Child already has an active enrollment in this classroom; use switch_classroom instead';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.children_classrooms
    WHERE classroom_teacher_id = p_classroom_teacher_id AND ended_at IS NULL;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'This teacher already has the maximum of % students', v_max;
  END IF;

  -- The program has to have been sold before the child can sit in it. A future start is fine —
  -- an admin may set a class up a week ahead — so only the lower bound is checked.
  SELECT min(lp.start_date) INTO v_period_start
    FROM public.learning_periods lp
    WHERE lp.child_id = p_child_id AND lp.classroom_id = v_classroom_id;

  IF v_period_start IS NOT NULL AND v_started_at < v_period_start THEN
    RAISE EXCEPTION 'Enrollment cannot start before the learning period (%)', v_period_start;
  END IF;

  INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at, created_by)
  VALUES (p_child_id, p_classroom_teacher_id, v_started_at, auth.uid());
END;
$$;

CREATE FUNCTION public.switch_classroom(
  p_child_id uuid,
  p_new_classroom_teacher_id uuid,
  p_end_reason text DEFAULT NULL,
  p_started_at date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_classroom_id uuid;
  v_max smallint;
  v_count int;
  v_started_at date := COALESCE(p_started_at, current_date);
  v_period_start date;
BEGIN
  SELECT ct.classroom_id, c.max_students_per_teacher
    INTO v_classroom_id, v_max
    FROM public.classroom_teachers ct
    JOIN public.classrooms c ON c.id = ct.classroom_id
    WHERE ct.id = p_new_classroom_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Classroom/teacher assignment not found';
  END IF;

  SELECT COUNT(*) INTO v_count
    FROM public.children_classrooms
    WHERE classroom_teacher_id = p_new_classroom_teacher_id AND ended_at IS NULL;

  IF v_count >= v_max THEN
    RAISE EXCEPTION 'This teacher already has the maximum of % students', v_max;
  END IF;

  SELECT min(lp.start_date) INTO v_period_start
    FROM public.learning_periods lp
    WHERE lp.child_id = p_child_id AND lp.classroom_id = v_classroom_id;

  IF v_period_start IS NOT NULL AND v_started_at < v_period_start THEN
    RAISE EXCEPTION 'Enrollment cannot start before the learning period (%)', v_period_start;
  END IF;

  -- Only the enrollment in the same program is closed; the child keeps their other programs.
  -- The old row ends on the day the new one starts, which is how this has always read: the
  -- handover day belongs to both teachers rather than falling in a gap between them.
  UPDATE public.children_classrooms cc
    SET ended_at = v_started_at, end_reason = p_end_reason
    FROM public.classroom_teachers ct
    WHERE ct.id = cc.classroom_teacher_id
      AND cc.child_id = p_child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = v_classroom_id;

  INSERT INTO public.children_classrooms (child_id, classroom_teacher_id, started_at, created_by)
  VALUES (p_child_id, p_new_classroom_teacher_id, v_started_at, auth.uid());
END;
$$;

COMMENT ON FUNCTION public.enroll_child_in_classroom(uuid, uuid, date) IS
  'Enrolls a child into one teaching group. p_started_at defaults to today; pass an earlier date '
  'when the paperwork is being filed late, so daily reports for the days already attended can '
  'still be written. Refuses a date before the child''s learning period in that classroom.';

COMMENT ON FUNCTION public.switch_classroom(uuid, uuid, text, date) IS
  'Moves a child to another teacher in the same classroom. p_started_at defaults to today and is '
  'both the old enrollment''s end and the new one''s start.';

GRANT EXECUTE ON FUNCTION public.enroll_child_in_classroom(uuid, uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.switch_classroom(uuid, uuid, text, date) TO authenticated, service_role;
