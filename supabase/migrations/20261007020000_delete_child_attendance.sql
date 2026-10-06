-- An admin can now remove an attendance day that should never have been recorded (owner request:
-- Ayyubi Asyraf Kusuma carries five August days from before he actually started, and his real
-- attendance begins 1 Oktober).
--
-- Until now there was no way to take a day back. record_attendance() corrects a day by
-- overwriting its status, which is right for "I marked hadir, she was sakit" but cannot express
-- "this day did not happen" — and a wrong day is not free: every non-sakit row consumes one of
-- the family's guaranteed days.
--
-- Teachers keep no delete (their RLS has never granted one; a mistake is corrected by
-- re-recording). admin_all_child_attendances already allows an admin to DELETE the row directly,
-- so this function exists for the bookkeeping either side of that delete, not for the permission.

CREATE OR REPLACE FUNCTION public.delete_child_attendance(p_attendance_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_id uuid;
  v_classroom_id uuid;
  v_date date;
  v_period_id uuid;
  v_guaranteed smallint;
  v_consumed int;
  v_close_date date;
BEGIN
  -- IS DISTINCT FROM, not <>: a caller with no role claim at all yields NULL, and `NULL <> 'admin'`
  -- is NULL, which an IF treats as false — the guard would wave through exactly the caller it is
  -- there to stop. SECURITY DEFINER means this check is the only thing standing in front of the
  -- delete; RLS is not consulted.
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Only an admin can delete attendance';
  END IF;

  SELECT ca.child_id, ca.classroom_id, ca.attendance_date, ca.learning_period_id
    INTO v_child_id, v_classroom_id, v_date, v_period_id
    FROM public.child_attendances ca
    WHERE ca.id = p_attendance_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance row not found';
  END IF;

  -- A daily report is filed against the day the child was present. Deleting the day underneath
  -- it would leave a report the present-only rule says cannot exist, and nothing would ever
  -- surface it again. Refused rather than silently cascaded, the same way delete_learning_period
  -- refuses a period that has attendance.
  IF EXISTS (
    SELECT 1
      FROM public.children_daily_reports r
      JOIN public.classroom_teachers ct ON ct.id = r.classroom_teacher_id
     WHERE r.child_id = v_child_id
       AND r.report_date = v_date
       AND ct.classroom_id = v_classroom_id
  ) THEN
    RAISE EXCEPTION 'Attendance has a daily report filed against it';
  END IF;

  DELETE FROM public.child_attendances WHERE id = p_attendance_id;

  -- Hand the day back to the family's quota. record_attendance() closes a period the moment the
  -- guaranteed days run out; removing a day has to be able to undo that, or the period stays
  -- closed on a count that is no longer true and the child can never be marked present again.
  SELECT lp.guaranteed_days INTO v_guaranteed
    FROM public.learning_periods lp WHERE lp.id = v_period_id;

  SELECT count(*) INTO v_consumed
    FROM public.child_attendances ca
    WHERE ca.learning_period_id = v_period_id AND ca.status <> 'sick';

  IF v_consumed >= v_guaranteed THEN
    -- Still full, but the day that closed it may be the one just removed, so actual_end_date is
    -- recomputed as the date of the guaranteed-th consuming day rather than left as it was.
    SELECT s.attendance_date INTO v_close_date
      FROM (
        SELECT ca.attendance_date,
               row_number() OVER (ORDER BY ca.attendance_date) AS rn
          FROM public.child_attendances ca
         WHERE ca.learning_period_id = v_period_id AND ca.status <> 'sick'
      ) s
     WHERE s.rn = v_guaranteed;

    UPDATE public.learning_periods
       SET actual_end_date = v_close_date,
           closed_at = COALESCE(closed_at, now())
     WHERE id = v_period_id;
  ELSE
    UPDATE public.learning_periods
       SET closed_at = NULL, actual_end_date = NULL
     WHERE id = v_period_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.delete_child_attendance(uuid) IS
  'Admin-only. Removes one attendance day and returns it to the learning period''s quota, '
  'reopening the period if that drops it back below its guaranteed days. Refuses when a daily '
  'report has been filed against the day.';

GRANT EXECUTE ON FUNCTION public.delete_child_attendance(uuid) TO authenticated, service_role;
