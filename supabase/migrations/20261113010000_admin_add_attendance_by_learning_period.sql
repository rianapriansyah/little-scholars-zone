-- Tambah Absen (admin, from a learning period's card) works from the period alone.
--
-- Until now the admin flow first resolved which teaching group the child sat in on the chosen date
-- (children_classrooms), because the report-save RPCs take (child, classroom_teacher_id, date). A
-- date not covered by any placement — e.g. a gap left by a mistyped ended_at — refused the whole
-- day, even though the absensi itself only needs the period.
--
-- Since 20261108050000 a report is identified by its absensi row (child_attendance_id) alone; its
-- group is derived, never stored. So the admin path no longer needs a group at all:
--
--   * save_daily_report_{mood,teacher_note,items}_for_period(p_learning_period_id, p_report_date, …)
--     Admin only. The period gives the child and class, the date gives the absensi row, and the
--     report is upserted on that row. The teacher RPCs keyed by (child, group, date) are unchanged.
--   * record_attendance: when an admin names the period (p_learning_period_id), the "currently
--     enrolled in this classroom" check is skipped — the period already proves the child belongs to
--     the class, and back-filling a day must not depend on today's placement. Teachers (no period
--     named) keep the check.
--
-- Reading the sheet back needs nothing new: daily_report_for_attendance(child, classroom, date)
-- already finds the report through the absensi row, and admins read daily_report_items directly.
--
-- A report written this way on a date no placement covers has no derived group
-- (daily_report_group_id is NULL): an admin and, once sent, the parent see it; no teacher does.

-- ---------------------------------------------------------------------------
-- 1. Resolver: (period, date) → the absensi row the report hangs off.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.daily_report_period_attendance_id(
  p_learning_period_id uuid,
  p_report_date date
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_child_id uuid;
  v_classroom_id uuid;
  v_attendance_id uuid;
BEGIN
  SELECT lp.child_id, lp.classroom_id INTO v_child_id, v_classroom_id
    FROM public.children_learning_periods lp
   WHERE lp.id = p_learning_period_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Periode belajar tidak ditemukan';
  END IF;

  -- One absensi row per (child, class, date). Not required to be filed on this very period: the
  -- report describes the day, whichever period the day is counted against.
  SELECT a.id INTO v_attendance_id
    FROM public.children_attendances a
   WHERE a.child_id = v_child_id
     AND a.classroom_id = v_classroom_id
     AND a.attendance_date = p_report_date
     AND a.status = 'present';

  IF v_attendance_id IS NULL THEN
    RAISE EXCEPTION 'Laporan harian hanya bisa diisi untuk siswa yang tercatat hadir di kelas ini pada %', p_report_date;
  END IF;

  RETURN v_attendance_id;
END;
$$;

COMMENT ON FUNCTION public.daily_report_period_attendance_id(uuid, date) IS
  'The ''present'' absensi row of a learning period''s child and class on one date, for the admin '
  'save_daily_report_*_for_period RPCs. Raises when there is none.';

REVOKE EXECUTE ON FUNCTION public.daily_report_period_attendance_id(uuid, date) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Admin writers keyed by (period, date).
--    No submitted lock: an admin may correct a sent report, as with the teacher RPCs.
-- ---------------------------------------------------------------------------

CREATE FUNCTION public.save_daily_report_mood_for_period(
  p_learning_period_id uuid,
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
  v_attendance_id uuid;
  v_report_id uuid;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Hanya admin yang dapat mengisi laporan dari periode belajar';
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

  v_attendance_id := public.daily_report_period_attendance_id(p_learning_period_id, p_report_date);

  -- child_id, classroom_id and attendance_status are overwritten from the absensi row by
  -- enforce_daily_report_child_present; child_id is passed only to satisfy the column list.
  INSERT INTO public.children_daily_reports (
    child_id, child_attendance_id, created_by, mood_arrival, mood_studying, mood_departure
  )
  SELECT a.child_id, a.id, auth.uid(), p_mood_arrival, p_mood_studying, p_mood_departure
    FROM public.children_attendances a
   WHERE a.id = v_attendance_id
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_attendance_id_key
  DO UPDATE SET
    mood_arrival = EXCLUDED.mood_arrival,
    mood_studying = EXCLUDED.mood_studying,
    mood_departure = EXCLUDED.mood_departure
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

CREATE FUNCTION public.save_daily_report_teacher_note_for_period(
  p_learning_period_id uuid,
  p_report_date date,
  p_teacher_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_report_id uuid;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Hanya admin yang dapat mengisi laporan dari periode belajar';
  END IF;

  v_attendance_id := public.daily_report_period_attendance_id(p_learning_period_id, p_report_date);

  INSERT INTO public.children_daily_reports (child_id, child_attendance_id, created_by, teacher_note)
  SELECT a.child_id, a.id, auth.uid(), NULLIF(btrim(p_teacher_note), '')
    FROM public.children_attendances a
   WHERE a.id = v_attendance_id
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_attendance_id_key
  DO UPDATE SET teacher_note = EXCLUDED.teacher_note
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

CREATE FUNCTION public.save_daily_report_items_for_period(
  p_learning_period_id uuid,
  p_report_date date,
  p_entries jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_report_id uuid;
BEGIN
  IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Hanya admin yang dapat mengisi laporan dari periode belajar';
  END IF;

  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'p_entries must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_entries) e
    GROUP BY e ->> 'curriculum_item_id'
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'p_entries contains duplicate curriculum_item_id values';
  END IF;

  v_attendance_id := public.daily_report_period_attendance_id(p_learning_period_id, p_report_date);

  INSERT INTO public.children_daily_reports (child_id, child_attendance_id, created_by)
  SELECT a.child_id, a.id, auth.uid()
    FROM public.children_attendances a
   WHERE a.id = v_attendance_id
  ON CONFLICT ON CONSTRAINT children_daily_reports_child_attendance_id_key
  DO UPDATE SET child_attendance_id = EXCLUDED.child_attendance_id
  RETURNING id INTO v_report_id;

  WITH incoming AS (
    SELECT (e ->> 'curriculum_item_id')::uuid AS curriculum_item_id
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

REVOKE EXECUTE ON FUNCTION public.save_daily_report_mood_for_period(uuid, date, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_daily_report_teacher_note_for_period(uuid, date, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.save_daily_report_items_for_period(uuid, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_daily_report_mood_for_period(uuid, date, text, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_daily_report_teacher_note_for_period(uuid, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_daily_report_items_for_period(uuid, date, jsonb) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. record_attendance: a named period replaces the current-enrolment check.
--    Identical to the live definition except for that one condition.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_attendance(
  p_child_id uuid,
  p_classroom_id uuid,
  p_date date,
  p_status text,
  p_note text DEFAULT NULL::text,
  p_learning_period_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_period_id uuid;
  v_existing_id uuid;
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

  IF p_learning_period_id IS NOT NULL THEN
    IF (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Only an admin can choose the learning period for a day';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.children_learning_periods lp
       WHERE lp.id = p_learning_period_id
         AND lp.child_id = p_child_id
         AND lp.classroom_id = p_classroom_id
    ) THEN
      RAISE EXCEPTION 'Periode belajar ini bukan milik anak dan kelas tersebut.';
    END IF;
  END IF;

  -- children_classrooms enrols into a (classroom, teacher) pair, so the classroom only comes
  -- out of the join through classroom_teachers. Skipped when an admin named the period: the period
  -- (checked above) already ties the child to this class, and back-filling an old day must not
  -- hinge on where the child is placed today.
  IF p_learning_period_id IS NULL AND NOT EXISTS (
    SELECT 1
    FROM public.children_classrooms cc
    JOIN public.classroom_teachers ct ON ct.id = cc.classroom_teacher_id
    WHERE cc.child_id = p_child_id
      AND cc.ended_at IS NULL
      AND ct.classroom_id = p_classroom_id
  ) THEN
    RAISE EXCEPTION 'Child is not actively enrolled in this classroom';
  END IF;

  -- A day with a daily report stays 'present': the report describes a day the child was there.
  -- children_daily_reports_attendance_fkey refuses the change at commit regardless; this says so
  -- in words. Re-saving 'present' (e.g. to edit the note) is still fine.
  IF p_status <> 'present' AND EXISTS (
    SELECT 1
      FROM public.children_daily_reports r
      JOIN public.children_attendances ca ON ca.id = r.child_attendance_id
     WHERE ca.child_id = p_child_id
       AND ca.classroom_id = p_classroom_id
       AND ca.attendance_date = p_date
  ) THEN
    RAISE EXCEPTION 'Absensi ini sudah punya laporan harian. Minta admin menghapus laporan dulu.';
  END IF;

  SELECT ca.id, ca.learning_period_id INTO v_existing_id, v_period_id
    FROM public.children_attendances ca
    WHERE ca.child_id = p_child_id
      AND ca.classroom_id = p_classroom_id
      AND ca.attendance_date = p_date;

  IF p_learning_period_id IS NOT NULL THEN
    -- The admin named the period. A date already filed elsewhere moves over first, so the old
    -- period's quota and closure are put right by the same code Pindahkan Absen uses.
    IF v_existing_id IS NOT NULL AND v_period_id <> p_learning_period_id THEN
      PERFORM public.move_child_attendances(ARRAY[v_existing_id], p_learning_period_id);
    END IF;
    v_period_id := p_learning_period_id;
  ELSIF v_period_id IS NULL THEN
    -- A correction stays in the period it was originally filed against, even once that period
    -- has closed. Only a genuinely new date needs an open period to draw from.
    SELECT lp.id INTO v_period_id
      FROM public.children_learning_periods lp
      WHERE lp.child_id = p_child_id
        AND lp.classroom_id = p_classroom_id
        AND lp.closed_at IS NULL
      ORDER BY lp.is_active DESC, lp.period_no
      LIMIT 1;

    IF v_period_id IS NULL THEN
      RAISE EXCEPTION 'No open learning period for this child in this classroom; create one first';
    END IF;
  END IF;

  INSERT INTO public.children_attendances (
    learning_period_id, child_id, classroom_id, attendance_date, status, note, recorded_by
  )
  VALUES (v_period_id, p_child_id, p_classroom_id, p_date, p_status, p_note, auth.uid())
  ON CONFLICT ON CONSTRAINT children_attendances_child_classroom_date_key
  DO UPDATE SET
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    recorded_by = EXCLUDED.recorded_by,
    recorded_at = now()
  RETURNING id INTO v_attendance_id;

  SELECT lp.guaranteed_days INTO v_guaranteed
    FROM public.children_learning_periods lp WHERE lp.id = v_period_id;

  SELECT count(*) INTO v_consumed
    FROM public.children_attendances ca
    WHERE ca.learning_period_id = v_period_id
      AND ca.status <> 'sick';

  -- Chosen periods only: the automatic pick only ever draws from an open one, which closes the
  -- moment it is full, and a teacher's correction keeps its old (unchecked) behaviour.
  IF p_learning_period_id IS NOT NULL AND v_consumed > v_guaranteed THEN
    RAISE EXCEPTION 'Periode ini sudah penuh (% hari). Pilih periode lain.', v_guaranteed;
  END IF;

  -- `closed_at IS NULL` keeps this idempotent: re-submitting the closing date is a no-op
  -- rather than bumping the timestamp.
  IF v_consumed >= v_guaranteed THEN
    UPDATE public.children_learning_periods
      SET closed_at = now(), actual_end_date = p_date
      WHERE id = v_period_id AND closed_at IS NULL;
  END IF;

  RETURN v_attendance_id;
END;
$function$;
